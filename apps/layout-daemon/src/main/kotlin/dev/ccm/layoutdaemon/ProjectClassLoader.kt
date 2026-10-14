package dev.ccm.layoutdaemon

import net.bytebuddy.jar.asm.ClassReader
import net.bytebuddy.jar.asm.ClassWriter
import net.bytebuddy.jar.asm.commons.ClassRemapper
import net.bytebuddy.jar.asm.commons.Remapper
import java.io.File
import java.net.URLClassLoader

/**
 * Child-first loader for the project's runtime classpath (AndroidX, Material, app classes, R.jar).
 * Platform packages always come from the parent: layoutlib's `android.*` must be the one the Bridge runs.
 */
class ProjectClassLoader(entries: List<File>, parent: ClassLoader) :
    URLClassLoader("ccm-project", entries.map { it.toURI().toURL() }.toTypedArray(), parent) {

    override fun loadClass(name: String, resolve: Boolean): Class<*> {
        synchronized(getClassLoadingLock(name)) {
            findLoadedClass(name)?.let { return it }
            if (name == BUILD || name.startsWith("$BUILD$")) return defineBuild(name)
            if (parentOnly(name)) return super.loadClass(name, resolve)
            val own = try {
                findClass(name)
            } catch (_: ClassNotFoundException) {
                null
            }
            val cls = own ?: parent.loadClass(name)
            if (resolve) resolveClass(cls)
            return cls
        }
    }

    /**
     * App code reads android.os.Build, which only android.jar has; layoutlib ships it as _Original_Build
     * (values from build.prop). Same trick as the mockable android.jar on Paparazzi's test classpath.
     */
    private fun defineBuild(name: String): Class<*> {
        val original = name.replace(BUILD, ORIGINAL_BUILD).replace('.', '/') + ".class"
        val bytes = parent.getResourceAsStream(original)?.use { it.readBytes() } ?: throw ClassNotFoundException(name)
        val writer = ClassWriter(0)
        ClassReader(bytes).accept(ClassRemapper(writer, BuildRemapper), 0)
        val out = writer.toByteArray()
        return defineClass(name, out, 0, out.size)
    }

    private object BuildRemapper : Remapper(net.bytebuddy.jar.asm.Opcodes.ASM9) {
        override fun map(internalName: String): String =
            if (internalName.startsWith(ORIGINAL_BUILD_INTERNAL)) BUILD_INTERNAL + internalName.removePrefix(ORIGINAL_BUILD_INTERNAL) else internalName
    }

    override fun getResource(name: String): java.net.URL? =
        if (parentOnly(name.replace('/', '.'))) super.getResource(name) else findResource(name) ?: parent.getResource(name)

    companion object {
        private const val BUILD = "android.os.Build"
        private const val ORIGINAL_BUILD = "android.os._Original_Build"
        private const val BUILD_INTERNAL = "android/os/Build"
        private const val ORIGINAL_BUILD_INTERNAL = "android/os/_Original_Build"

        private val PARENT_PREFIXES = listOf(
            "java.", "javax.", "jdk.", "sun.", "com.sun.",
            "android.", "dalvik.", "libcore.", "com.android.internal.", "com.android.layoutlib.",
            "com.android.tools.layoutlib.", "com.android.ide.common.rendering.api.",
            "org.xmlpull.", "org.kxml2.", "org.w3c.", "org.xml.", "org.json.", "org.apache.http.",
            "dev.ccm.layoutdaemon.", "app.cash.paparazzi.",
        )
        // Legacy support library classes live in the project jars even though they start with `android.`.
        private val CHILD_PREFIXES = listOf("android.support.", "android.arch.")

        fun parentOnly(name: String): Boolean =
            CHILD_PREFIXES.none { name.startsWith(it) } && PARENT_PREFIXES.any { name.startsWith(it) }
    }
}
