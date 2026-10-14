package dev.ccm.layoutdaemon

import com.android.ide.common.rendering.api.ActionBarCallback
import com.android.ide.common.rendering.api.AdapterBinding
import com.android.ide.common.rendering.api.ILayoutPullParser
import com.android.ide.common.rendering.api.LayoutlibCallback
import com.android.ide.common.rendering.api.ResourceNamespace
import com.android.ide.common.rendering.api.ResourceReference
import com.android.ide.common.rendering.api.ResourceValue
import com.android.ide.common.resources.ResourceRepository
import com.android.resources.ResourceType
import org.kxml2.io.KXmlParser
import org.xmlpull.v1.XmlPullParser
import java.io.File
import java.io.FileNotFoundException
import java.lang.reflect.InvocationTargetException
import java.lang.reflect.Modifier
import java.util.concurrent.Callable
import java.util.concurrent.Executors
import java.util.zip.ZipFile

data class AarRes(val dir: File, val name: String)

data class ProjectSpec(
    val resDirs: List<File>,
    val aarRes: List<AarRes>,
    val classpath: List<File>,
    val rJar: File?,
    val packageName: String,
    val namespace: String,
    val appTheme: String?,
    val activityThemes: Map<String, String>,
    val minSdk: Int?,
    val targetSdk: Int?,
)

/**
 * R ids from every R class in R.jar (with nonTransitiveRClass the app's R only holds its own resources;
 * library R classes hold theirs, all with the final app-wide values) plus stable dynamic ids.
 */
class ResourceIds {
    private val byId = HashMap<Int, ResourceReference>()
    private val byRef = HashMap<ResourceReference, Int>()
    private var nextDynamic = DYNAMIC_BASE

    val size get() = byId.size

    /** [styleNames] maps `Theme_App` (R field) back to `Theme.App`; layoutlib looks styles up by their real name. */
    fun load(rClass: Class<*>, styleNames: Map<String, String>) {
        for (inner in rClass.declaredClasses) {
            val type = ResourceType.fromClassName(inner.simpleName) ?: continue
            for (field in inner.declaredFields) {
                if (!Modifier.isStatic(field.modifiers) || field.isSynthetic || field.type != Int::class.javaPrimitiveType) continue
                val value = runCatching { field.getInt(null) }.getOrNull() ?: continue
                val name = if (type == ResourceType.STYLE) styleNames[field.name] ?: field.name else field.name
                val ref = ResourceReference(ResourceNamespace.RES_AUTO, type, name)
                byId[value] = ref
                byRef[ref] = value
            }
        }
    }

    fun resolve(id: Int): ResourceReference? = byId[id]

    fun idOf(ref: ResourceReference): Int {
        byRef[ref]?.let { return it }
        if (ref.resourceType == ResourceType.STYLE) {
            byRef[ResourceReference(ref.namespace, ref.resourceType, ref.name.replace('.', '_'))]?.let { return it }
        }
        val id = nextDynamic++
        byId[id] = ref
        byRef[ref] = id
        return id
    }

    companion object {
        // Above every aapt2 type id (0x7f01..0x7f2x) so generated ids never collide with R.
        private const val DYNAMIC_BASE = 0x7fa00000
    }
}

/** layoutlib's view of the project: classes from [loader], ids from [ids]. Replaces PaparazziCallback. */
class ProjectCallback(
    val loader: ClassLoader,
    private val applicationId: String,
    private val ids: ResourceIds,
) : LayoutlibCallback() {
    private val actionBar = ActionBarCallback()

    /** Set per render: turns a view whose constructor threw into a placeholder instead of failing the whole inflate. */
    @Volatile var onViewFailure: ((name: String, error: Throwable, args: Array<Any?>) -> Any?)? = null

    override fun loadView(name: String, constructorSignature: Array<Class<*>>, constructorArgs: Array<Any?>): Any? {
        val cls = try {
            findClass(name)
        } catch (e: ClassNotFoundException) {
            val cause = e.cause
            if (cause is LinkageError || cause is ExceptionInInitializerError) {
                return onViewFailure?.invoke(name, cause, constructorArgs) ?: throw e
            }
            throw e
        }
        return try {
            cls.getConstructor(*constructorSignature).apply { isAccessible = true }.newInstance(*constructorArgs)
        } catch (e: InvocationTargetException) {
            onViewFailure?.invoke(name, e.targetException ?: e, constructorArgs) ?: throw e
        } catch (e: LinkageError) {
            onViewFailure?.invoke(name, e, constructorArgs) ?: throw e
        }
    }

    override fun loadClass(name: String, constructorSignature: Array<Class<*>>, constructorArgs: Array<Any?>): Any? = try {
        if (name in RECYCLER_ADAPTERS) {
            RecyclerAdapters.create(findClass(name))
        } else {
            findClass(name).getConstructor(*constructorSignature).apply { isAccessible = true }.newInstance(*constructorArgs)
        }
    } catch (_: ClassNotFoundException) {
        null
    }

    override fun findClass(name: String): Class<*> = try {
        Class.forName(name, true, loader)
    } catch (e: LinkageError) {
        throw ClassNotFoundException("error loading class $name", e)
    } catch (e: ExceptionInInitializerError) {
        throw ClassNotFoundException("error loading class $name", e)
    }

    fun canLoad(name: String): Boolean = try {
        Class.forName(name, false, loader)
        true
    } catch (_: ClassNotFoundException) {
        false
    } catch (_: LinkageError) {
        false
    }

    override fun resolveResourceId(id: Int): ResourceReference? = ids.resolve(id)

    override fun getOrGenerateResourceId(resource: ResourceReference): Int = ids.idOf(resource)

    override fun getParser(layoutResource: ResourceValue): ILayoutPullParser? {
        val path = layoutResource.value ?: return null
        if (layoutResource.resourceType == ResourceType.AAPT) return null
        return try {
            PaparazziInternals.parserFromFile(File(path))
        } catch (_: FileNotFoundException) {
            null
        }
    }

    override fun getAdapterBinding(viewObject: Any?, attributes: MutableMap<String, String>?): AdapterBinding? = null

    override fun getActionBarCallback(): ActionBarCallback = actionBar

    override fun createXmlParserForPsiFile(fileName: String): XmlPullParser? = createXmlParserForFile(fileName)

    override fun createXmlParserForFile(fileName: String): XmlPullParser? = try {
        KXmlParser().apply {
            setFeature(XmlPullParser.FEATURE_PROCESS_NAMESPACES, true)
            setInput(File(fileName).readBytes().inputStream(), null)
        }
    } catch (_: Exception) {
        null
    }

    override fun createXmlParser(): XmlPullParser = KXmlParser()

    override fun getApplicationId(): String = applicationId

    override fun getResourcePackage(): String = applicationId

    companion object {
        private val RECYCLER_ADAPTERS = setOf(
            "androidx.recyclerview.widget.RecyclerView\$Adapter",
            "android.support.v7.widget.RecyclerView\$Adapter",
        )
    }
}

/** A loaded project: resources (project res + AAR res) and classes (isolated loader). Lives on the render thread. */
class LoadedProject(val spec: ProjectSpec, private val parentLoader: ClassLoader) {
    val warnings = ArrayList<String>()
    private var aarRepos: List<ResourceRepository> = emptyList()
    lateinit var resources: ResourceRepository
        private set
    private var loader: ProjectClassLoader? = null
    lateinit var callback: ProjectCallback
        private set
    var classReloads = 0
        private set
    var generation = 0
        private set
    var rIdCount = 0
        private set

    fun load() {
        aarRepos = loadAars()
        loadLocalResources()
        loadClasses()
    }

    fun reloadResources() {
        loadLocalResources()
        // Style names feed the R-id mapping, so ids follow the new repository.
        rebuildCallback()
    }

    /** Re-activation from the cache: res may have changed while inactive; [classes] = the build output changed too. */
    fun refresh(classes: Boolean) {
        loadLocalResources()
        if (classes) reloadClasses() else rebuildCallback()
    }

    fun reloadClasses() {
        classReloads++
        loadClasses()
    }

    fun close() {
        runCatching { loader?.close() }
        loader = null
    }

    /** `tools:context` (`.MainActivity` or FQN) → activity theme → app theme. */
    fun themeFor(toolsContext: String?): String? {
        val activity = toolsContext?.trim()?.takeIf { it.isNotEmpty() }?.let { qualify(it) }
        return activity?.let { spec.activityThemes[it] } ?: spec.appTheme
    }

    private fun qualify(name: String): String = when {
        name.startsWith('.') -> spec.namespace + name
        '.' !in name -> "${spec.namespace}.$name"
        else -> name
    }

    private fun loadAars(): List<ResourceRepository> {
        if (spec.aarRes.isEmpty()) return emptyList()
        val pool = Executors.newFixedThreadPool(Runtime.getRuntime().availableProcessors().coerceIn(1, 8))
        try {
            val futures = spec.aarRes.map { aar ->
                pool.submit(Callable { runCatching { PaparazziInternals.aarRepository(aar.dir.toPath(), aar.name) } })
            }
            return futures.mapIndexedNotNull { i, f ->
                f.get().getOrElse { t ->
                    warnings += "AAR resources skipped (${spec.aarRes[i].name}): ${t.describe()}"
                    null
                }
            }
        } finally {
            pool.shutdown()
        }
    }

    private fun loadLocalResources() {
        resources = PaparazziInternals.appRepository(spec.resDirs.filter { it.isDirectory }, aarRepos)
        generation++
    }

    private fun loadClasses() {
        close()
        val entries = (spec.classpath + listOfNotNull(spec.rJar)).filter { it.exists() }.distinct()
        loader = ProjectClassLoader(entries, parentLoader)
        rebuildCallback()
    }

    private fun rebuildCallback() {
        val ids = ResourceIds()
        val l = loader ?: parentLoader
        val styles = resources.getResources(ResourceNamespace.RES_AUTO, ResourceType.STYLE).keySet().associateBy { it.replace('.', '_') }
        val rClasses = LinkedHashSet<String>()
        rClasses += "${spec.namespace}.R"
        spec.rJar?.takeIf { it.isFile }?.let { jar ->
            runCatching {
                ZipFile(jar).use { zip ->
                    zip.entries().asSequence().map { it.name }.filter { it.endsWith("/R.class") }
                        .forEach { rClasses += it.removeSuffix(".class").replace('/', '.') }
                }
            }.onFailure { warnings += "R.jar unreadable: ${it.describe()}" }
        }
        for (name in rClasses) {
            try {
                ids.load(Class.forName(name, true, l), styles)
            } catch (_: ClassNotFoundException) {
                if (name == "${spec.namespace}.R") {
                    warnings += "R class $name not found — library views using R.styleable will fail; build the project"
                }
            } catch (t: Throwable) {
                warnings += "R class $name unreadable: ${t.describe()}"
            }
        }
        rIdCount = ids.size
        callback = ProjectCallback(l, spec.packageName, ids)
        generation++
    }
}
