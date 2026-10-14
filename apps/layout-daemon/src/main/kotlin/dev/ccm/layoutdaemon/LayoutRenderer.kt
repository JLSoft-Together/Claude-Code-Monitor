package dev.ccm.layoutdaemon

import android.content.Context
import android.util.AttributeSet
import android.view.BridgeInflater
import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import android.widget.FrameLayout
import app.cash.paparazzi.DeviceConfig
import app.cash.paparazzi.Environment
import app.cash.paparazzi.PaparazziSdk
import com.android.ide.common.rendering.api.ResourceNamespace
import com.android.ide.common.resources.configuration.LocaleQualifier
import com.android.layoutlib.bridge.Bridge
import com.android.layoutlib.bridge.MockView
import com.android.layoutlib.bridge.android.BridgeContext
import com.android.layoutlib.bridge.android.BridgeXmlBlockParser
import com.android.resources.Density
import com.android.resources.LayoutDirection
import com.android.resources.NightMode
import com.android.resources.ScreenOrientation
import com.android.resources.ScreenRatio
import com.android.resources.ScreenSize
import org.xmlpull.v1.XmlPullParserException
import java.awt.image.BufferedImage
import java.io.File
import java.util.IdentityHashMap
import java.util.Properties

data class Device(val width: Int, val height: Int, val density: Int)

data class RenderRequest(
    val requestId: String,
    val layoutPath: String?,
    val xml: String,
    val device: Device,
    val theme: String?,
    val night: Boolean,
    val locale: String?,
    val apiLevel: Int?,
)

class ViewNode(
    val cls: String,
    val xmlId: String?,
    val line: Int?,
    val column: Int?,
    val bounds: IntArray,
    val children: List<ViewNode>,
)

class RenderOutcome(
    val png: String?,
    val width: Int,
    val height: Int,
    val viewTree: ViewNode?,
    val diagnostics: List<Diagnostic>,
    val renderMs: Long,
    val timings: Map<String, Long>,
)

data class InitInfo(val layoutlibVersion: String, val apiLevel: Int, val initMs: Long)

private data class Config(
    val width: Int,
    val height: Int,
    val dpi: Int,
    val theme: String,
    val night: Boolean,
    val locale: String?,
    val projectGen: Int,
)

class ProjectLoadInfo(
    val resCount: Int,
    val classpathCount: Int,
    val rIds: Int,
    val warnings: List<String>,
    val loadMs: Long,
    val reused: Boolean,
    val cached: Int,
)

class ProjectChangeInfo(val kind: String, val ms: Long, val restartSuggested: Boolean, val warnings: List<String>)

class LayoutRenderer(private val layoutlibDir: File) {
    private lateinit var sdk: PaparazziSdk
    private var frameHook: ((BufferedImage) -> Unit)? = null
    private var config: Config? = null
    private lateinit var pngDir: File
    private var seq = 0L
    private val classCache = HashMap<String, Boolean>()
    private lateinit var swapper: SessionSwapper
    private lateinit var frameworkCallback: ProjectCallback
    private var project: LoadedProject? = null
    private val cache = LinkedHashMap<String, LoadedProject>(MAX_CACHED_PROJECTS + 1, 0.75f, true)
    var loadersCreated = 0
        private set
    val frameworkOnly get() = project == null
    var apiLevel = 36
        private set
    val initialized get() = ::sdk.isInitialized

    fun initialize(cacheDir: File): InitInfo {
        val t0 = System.nanoTime()
        if (initialized) return InitInfo(layoutlibVersion(), apiLevel, 0)
        val runtime = File(layoutlibDir, "runtime")
        val resources = File(layoutlibDir, "resources")
        require(File(runtime, "build.prop").isFile) { "layoutlib runtime missing: $runtime/build.prop" }
        require(File(resources, "res").isDirectory) { "layoutlib resources missing: $resources/res" }
        try {
            Class.forName("com.android.layoutlib.bridge.Bridge")
        } catch (_: ClassNotFoundException) {
            error("layoutlib jar is not on the classpath (-cp layout-daemon.jar${File.pathSeparator}<dir>/layoutlib-<ver>.jar)")
        }
        System.setProperty("paparazzi.layoutlib.runtime.root", runtime.absolutePath)
        System.setProperty("paparazzi.layoutlib.resources.root", resources.absolutePath)
        apiLevel = readSdkLevel(File(runtime, "build.prop")) ?: apiLevel

        pngDir = File(cacheDir, "render").apply { mkdirs() }
        pngDir.listFiles { f -> f.name.endsWith(".png") }?.forEach { it.delete() }

        val initial = Config(1080, 2340, 440, DEFAULT_THEME, false, null, 0)
        sdk = PaparazziSdk(
            environment = Environment(
                appTestDir = cacheDir.absolutePath,
                packageName = "dev.ccm.preview",
                compileSdkVersion = apiLevel,
                resourcePackageNames = emptyList(),
                localResourceDirs = emptyList(),
                moduleResourceDirs = emptyList(),
                libraryResourceDirs = emptyList(),
                allModuleAssetDirs = emptyList(),
                libraryAssetDirs = emptyList(),
            ),
            deviceConfig = initial.toDeviceConfig(),
            theme = initial.theme,
            supportsRtl = true,
            useDeviceResolution = true,
            onNewFrame = { frameHook?.invoke(it) },
        )
        sdk.setup()
        sdk.prepare()
        swapper = SessionSwapper(sdk)
        frameworkCallback = ProjectCallback(daemonLoader, "dev.ccm.preview", ResourceIds())
        config = null
        render(RenderRequest("warmup", null, WARMUP_XML, Device(initial.width, initial.height, initial.dpi), null, false, null, null), writePng = false)
        return InitInfo(layoutlibVersion(), apiLevel, (System.nanoTime() - t0) / 1_000_000)
    }

    fun render(req: RenderRequest, writePng: Boolean = true): RenderOutcome {
        check(initialized) { "not initialized" }
        val t0 = System.nanoTime()
        val diags = ArrayList<Diagnostic>()
        if (req.apiLevel != null && req.apiLevel != apiLevel) {
            diags += Diagnostic("info", "Rendered with API $apiLevel (layoutlib); requested API ${req.apiLevel}")
        }
        val wanted = req.toConfig(diags)
        val p = project
        val callback = p?.callback ?: frameworkCallback
        try {
            if (wanted != config) {
                LogCapture.collect(diags) {
                    swapper.swap(
                        device = wanted.toDeviceConfig(),
                        theme = wanted.theme,
                        projectResources = p?.resources ?: swapper.emptyProjectResources,
                        callback = callback,
                        minSdk = p?.spec?.minSdk ?: 0,
                        targetSdk = p?.spec?.targetSdk ?: apiLevel,
                    )
                }
                config = wanted
            }
        } catch (t: Throwable) {
            diags += Diagnostic("error", "Device/theme config failed: ${t.describe()}")
            config = null
        }
        val t1 = System.nanoTime()

        val parser = LayoutParser(req.xml)
        var image: BufferedImage? = null
        var tree: ViewNode? = null
        var t2 = t1
        LogCapture.collect(diags) {
            val ctx = sdk.context as BridgeContext
            val mocks = IdentityHashMap<View, String>()
            val isMerge = parser.starts.firstOrNull()?.name == "merge"
            var view: View? = null
            val prevLog = Bridge.getLog()
            callback.onViewFailure = { name, error, args -> brokenView(name, error, args, diags, mocks, ctx) { parser.current } }
            try {
                setBridgeLog(CookieLog(diags) { parser.current })
                val inflater = sdk.layoutInflater.cloneInContext(ctx)
                inflater.factory2 = PlaceholderFactory(ctx, diags, mocks) { parser.current }
                val block = BridgeXmlBlockParser(parser, ctx, ResourceNamespace.RES_AUTO)
                view = try {
                    inflater.inflate(block, FrameLayout(ctx), isMerge)
                } finally {
                    block.ensurePopped()
                }
            } catch (t: Throwable) {
                diags += inflateDiagnostic(t, parser)
            } finally {
                setBridgeLog(prevLog)
                callback.onViewFailure = null
            }
            t2 = System.nanoTime()
            val root = view
            if (root != null) {
                try {
                    frameHook = { img ->
                        image = img
                        tree = buildTree(ctx, root, mocks, if (isMerge) parser.starts.first() else null)
                    }
                    // Frame time 0 on a later render aborts the JVM in hwui ("0 isn't a real frame time!") once an
                    // AnimatedVectorDrawable (indeterminate ProgressBar) has run; 1 ms keeps every frame non-zero.
                    sdk.snapshot(root, 1L)
                } catch (t: Throwable) {
                    diags += Diagnostic("error", "Render failed: ${t.describe()}")
                    config = null
                } finally {
                    frameHook = null
                }
            }
            clearViewKeys(ctx)
            flushPaparazziErrors()
        }
        val t3 = System.nanoTime()

        var pngPath: String? = null
        val img = image
        if (img != null && writePng) {
            val file = File(pngDir, "${++seq}.png")
            PngWriter.write(img, file)
            pngPath = file.absolutePath
            File(pngDir, "${seq - KEEP_PNGS}.png").delete()
        }
        val t4 = System.nanoTime()
        val ms = { a: Long, b: Long -> (b - a) / 1_000_000 }
        return RenderOutcome(
            png = pngPath,
            width = img?.width ?: wanted.width,
            height = img?.height ?: wanted.height,
            viewTree = tree,
            diagnostics = diags,
            renderMs = ms(t0, t4),
            timings = linkedMapOf(
                "configMs" to ms(t0, t1),
                "inflateMs" to ms(t1, t2),
                "drawMs" to ms(t2, t3),
                "pngMs" to ms(t3, t4),
            ),
        )
    }

    /**
     * [projectId] = stable id from the IDE; such projects stay warm in an LRU of [MAX_CACHED_PROJECTS].
     * Without it the single anonymous slot is replaced (pre-cache behaviour).
     */
    fun loadProject(spec: ProjectSpec?, projectId: String? = null, classesChanged: Boolean = false): ProjectLoadInfo {
        check(initialized) { "not initialized" }
        val t0 = System.nanoTime()
        project = null
        config = null
        classCache.clear()
        if (spec == null) return ProjectLoadInfo(0, 0, 0, emptyList(), 0, reused = false, cached = cache.size)
        val key = projectId ?: ANONYMOUS
        val existing = cache[key]
        val reuse = existing != null && projectId != null && existing.spec == spec
        val p = try {
            if (reuse) {
                existing!!.warnings.clear()
                existing.refresh(classes = classesChanged)
                if (classesChanged) loadersCreated++
                existing
            } else {
                cache.remove(key)?.close()
                LoadedProject(spec, daemonLoader).also {
                    try {
                        it.load()
                    } catch (t: Throwable) {
                        it.close()
                        throw t
                    }
                    loadersCreated++
                    cache[key] = it
                }
            }
        } catch (t: Throwable) {
            cache.remove(key)?.close()
            throw t
        }
        project = p
        evictBeyondCap(keep = key)
        return ProjectLoadInfo(
            resCount = spec.resDirs.count { it.isDirectory } + spec.aarRes.size,
            classpathCount = spec.classpath.size + (if (spec.rJar != null) 1 else 0),
            rIds = p.rIdCount,
            warnings = p.warnings.toList(),
            loadMs = (System.nanoTime() - t0) / 1_000_000,
            reused = reuse,
            cached = cache.size,
        )
    }

    private fun evictBeyondCap(keep: String) {
        val it = cache.entries.iterator()
        while (cache.size > MAX_CACHED_PROJECTS && it.hasNext()) {
            val e = it.next()
            if (e.key == keep) continue
            it.remove()
            e.value.close()
        }
    }

    fun projectChanged(kind: String): ProjectChangeInfo? {
        val p = project ?: return null
        val t0 = System.nanoTime()
        p.warnings.clear()
        when (kind) {
            "res" -> p.reloadResources()
            "classes" -> {
                p.reloadClasses()
                loadersCreated++
            }
            else -> throw IllegalArgumentException("kind must be 'res' or 'classes'")
        }
        config = null
        classCache.clear()
        return ProjectChangeInfo(kind, (System.nanoTime() - t0) / 1_000_000, restartSuggested, p.warnings.toList())
    }

    val restartSuggested get() = loadersCreated > MAX_PROJECT_LOADERS

    fun shutdown() {
        // PaparazziSdk.teardown() rethrows every logged render error; the process exits right after anyway.
    }

    private fun RenderRequest.toConfig(diags: MutableList<Diagnostic>): Config {
        val qualifier = locale?.takeIf { it.isNotBlank() }?.let { tag ->
            val q = localeQualifier(tag)
            if (LocaleQualifier.getQualifier(q) == null) {
                diags += Diagnostic("warning", "Unknown locale '$tag', using default")
                null
            } else {
                q
            }
        }
        val requested = theme?.trim()?.takeIf { it.isNotEmpty() }
        var resolved = normalizeTheme(requested ?: project?.themeFor(LayoutParser.toolsContext(xml)))
        if (project == null && !resolved.startsWith("android:")) {
            diags += Diagnostic("warning", "Theme '$resolved' comes from the project; build the project to use it (framework default shown)")
            resolved = DEFAULT_THEME
        }
        return Config(
            width = device.width.coerceIn(16, 8192),
            height = device.height.coerceIn(16, 8192),
            dpi = device.density.coerceIn(72, 1280),
            theme = resolved,
            night = night,
            locale = qualifier,
            projectGen = project?.generation ?: 0,
        )
    }

    private fun Config.toDeviceConfig(): DeviceConfig {
        val dp = { px: Int -> px * 160 / dpi }
        val smallest = minOf(dp(width), dp(height))
        val longSide = maxOf(width, height).toFloat() / minOf(width, height)
        val language = locale?.removePrefix("b+")?.split('+', '-')?.firstOrNull()
        return DeviceConfig.PIXEL_5.copy(
            screenHeight = height,
            screenWidth = width,
            xdpi = dpi,
            ydpi = dpi,
            orientation = if (width > height) ScreenOrientation.LANDSCAPE else ScreenOrientation.PORTRAIT,
            nightMode = if (night) NightMode.NIGHT else NightMode.NOTNIGHT,
            density = Density.create(dpi),
            layoutDirection = if (language != null && Bridge.isLocaleRtl(language)) LayoutDirection.RTL else LayoutDirection.LTR,
            locale = locale,
            ratio = if (longSide > 1.67f) ScreenRatio.LONG else ScreenRatio.NOTLONG,
            size = when {
                smallest >= 720 -> ScreenSize.XLARGE
                smallest >= 600 -> ScreenSize.LARGE
                smallest >= 320 -> ScreenSize.NORMAL
                else -> ScreenSize.SMALL
            },
        )
    }

    private fun inflateDiagnostic(t: Throwable, parser: LayoutParser): Diagnostic {
        var c: Throwable? = t
        while (c != null) {
            if (c is XmlPullParserException) {
                val msg = (c.message ?: "XML error").substringBefore(" (position:").trim()
                return Diagnostic("error", "XML: $msg", c.lineNumber.takeIf { it > 0 }, c.columnNumber.takeIf { it > 0 })
            }
            c = c.cause.takeIf { it !== c }
        }
        val at = parser.current
        return Diagnostic("error", "Inflate failed: ${t.describe()}", at?.line, at?.column)
    }

    private fun buildTree(ctx: BridgeContext, root: View, mocks: Map<View, String>, mergeTag: TagStart?): ViewNode? {
        var ox = 0
        var oy = 0
        var p = root.parent as? View
        while (p != null) {
            ox += p.left - p.scrollX
            oy += p.top - p.scrollY
            p = p.parent as? View
        }
        val nodes = collect(ctx, root, ox, oy, mocks)
        if (mergeTag == null) return nodes.firstOrNull()
        val x = ox + root.left
        val y = oy + root.top
        return ViewNode("merge", null, mergeTag.line, mergeTag.column, intArrayOf(x, y, x + root.width, y + root.height), nodes)
    }

    private fun collect(ctx: BridgeContext, v: View, px: Int, py: Int, mocks: Map<View, String>): List<ViewNode> {
        val x = px + v.left
        val y = py + v.top
        val children = ArrayList<ViewNode>()
        if (v is ViewGroup) {
            for (i in 0 until v.childCount) children += collect(ctx, v.getChildAt(i), x - v.scrollX, y - v.scrollY, mocks)
        }
        val key = ctx.getViewKey(v) as? TagInfo ?: return children
        return listOf(
            ViewNode(mocks[v] ?: (if (v is MockView) key.name else v.javaClass.name), key.xmlId, key.line, key.column, intArrayOf(x, y, x + v.width, y + v.height), children),
        )
    }

    private fun setBridgeLog(log: com.android.ide.common.rendering.api.ILayoutLog?) {
        val lock = Bridge.getLock()
        lock.lock()
        try {
            Bridge.setLog(log)
        } finally {
            lock.unlock()
        }
    }

    // BridgeContext keeps every inflated view in these maps for the whole session; clear them so warm renders don't leak.
    private fun clearViewKeys(ctx: BridgeContext) {
        for (name in listOf("mViewKeyMap", "mViewKeyHelpMap")) {
            runCatching {
                val f = BridgeContext::class.java.getDeclaredField(name)
                f.isAccessible = true
                (f.get(ctx) as? MutableMap<*, *>)?.clear()
            }
        }
    }

    // PaparazziLogger keeps every logged throwable for teardown's assertNoErrors(); drop them per render.
    private fun flushPaparazziErrors() {
        runCatching {
            val f = PaparazziSdk::class.java.getDeclaredField("logger")
            f.isAccessible = true
            val logger = f.get(sdk)
            logger.javaClass.getMethod("flushErrors").invoke(logger)
        }
    }

    private fun layoutlibVersion(): String {
        val path = runCatching { Bridge::class.java.protectionDomain.codeSource.location.path }.getOrNull() ?: return "unknown"
        return Regex("layoutlib-([0-9][^/\\\\]*?)\\.jar$").find(path)?.groupValues?.get(1) ?: "unknown"
    }

    private fun readSdkLevel(buildProp: File): Int? = runCatching {
        Properties().apply { buildProp.inputStream().use(::load) }.getProperty("ro.build.version.sdk")?.trim()?.toInt()
    }.getOrNull()

    private inner class PlaceholderFactory(
        private val ctx: BridgeContext,
        private val diags: MutableList<Diagnostic>,
        private val mocks: MutableMap<View, String>,
        private val currentTag: () -> TagInfo?,
    ) : LayoutInflater.Factory2 {
        override fun onCreateView(parent: View?, name: String, context: Context, attrs: AttributeSet): View? {
            val className = if (name == "view") attrs.getAttributeValue(null, "class") ?: return null else name
            if (className in SPECIAL_TAGS || resolvable(className)) return null
            val at = currentTag()
            val hint = if (project == null) "build the project to render it" else "not in the project model; build the project or refresh the project model"
            LogCapture.add(diags, Diagnostic("error", "Class not found: $className — $hint (placeholder shown)", at?.line, at?.column))
            val mock = MockView(context, attrs)
            mock.setText(className.substringAfterLast('.'))
            mocks[mock] = className
            if (at != null) ctx.addViewKey(mock, at)
            return mock
        }

        override fun onCreateView(name: String, context: Context, attrs: AttributeSet): View? =
            onCreateView(null, name, context, attrs)
    }

    private fun resolvable(className: String): Boolean = classCache.getOrPut(className) {
        if ('.' in className) {
            (project?.callback ?: frameworkCallback).canLoad(className)
        } else {
            (BridgeInflater.getClassPrefixList().toList() + "android.view.").any { frameworkCallback.canLoad(it + className) }
        }
    }

    private fun brokenView(
        name: String,
        error: Throwable,
        args: Array<Any?>,
        diags: MutableList<Diagnostic>,
        mocks: MutableMap<View, String>,
        ctx: BridgeContext,
        currentTag: () -> TagInfo?,
    ): View? {
        val context = args.getOrNull(0) as? Context ?: return null
        val attrs = args.getOrNull(1) as? AttributeSet
        val at = currentTag()
        val hint = if (error is LinkageError) " — a dependency class is missing; build the project" else " — guard device-only code with isInEditMode()"
        LogCapture.add(diags, Diagnostic("error", "$name failed to render: ${error.describe()}$hint (placeholder shown)", at?.line, at?.column))
        val mock = MockView(context, attrs)
        mock.setText(name.substringAfterLast('.'))
        mocks[mock] = name
        if (at != null) ctx.addViewKey(mock, at)
        return mock
    }

    companion object {
        const val DEFAULT_THEME = "android:Theme.DeviceDefault.DayNight"
        // Each project ClassLoader leaves layoutlib/JDK caches behind; past this the IDE should restart the daemon.
        const val MAX_PROJECT_LOADERS = 6
        // Each cached project pins its AAR repositories + ClassLoader (tens of MB on a real app) under -Xmx1g.
        const val MAX_CACHED_PROJECTS = 3
        private const val ANONYMOUS = " anonymous"
        private val daemonLoader: ClassLoader = LayoutRenderer::class.java.classLoader
        private const val KEEP_PNGS = 8
        private val SPECIAL_TAGS = setOf("fragment", "include", "merge", "requestFocus", "tag", "blink")
        private const val WARMUP_XML = """<FrameLayout xmlns:android="http://schemas.android.com/apk/res/android"
    android:layout_width="match_parent" android:layout_height="match_parent"><TextView android:layout_width="wrap_content" android:layout_height="wrap_content" android:text="warmup"/></FrameLayout>"""

        fun normalizeTheme(theme: String?): String {
            val t = theme?.trim().orEmpty()
            if (t.isEmpty()) return DEFAULT_THEME
            return when {
                t.startsWith("@android:style/") -> "android:" + t.removePrefix("@android:style/")
                t.startsWith("@style/") -> t.removePrefix("@style/")
                t.startsWith("@android:") -> "android:" + t.removePrefix("@android:")
                else -> t.removePrefix("@")
            }
        }

        /** BCP-47 (`en-US`, `zh-Hans-CN`) → Android qualifier (`en-rUS`, `b+zh+Hans+CN`); qualifiers pass through. */
        fun localeQualifier(tag: String): String {
            if (tag.startsWith("b+") || Regex("^[a-zA-Z]{2,3}(-r[a-zA-Z0-9]{2,3})?$").matches(tag)) return tag
            val parts = tag.replace('_', '-').split('-').filter { it.isNotEmpty() }
            return when {
                parts.size == 1 -> parts[0].lowercase()
                parts.size == 2 && parts[1].length in 2..3 -> "${parts[0].lowercase()}-r${parts[1].uppercase()}"
                else -> "b+" + parts.joinToString("+")
            }
        }
    }
}
