package dev.ccm.layoutdaemon.kitgen

import net.bytebuddy.jar.asm.ClassWriter
import net.bytebuddy.jar.asm.Opcodes
import java.io.File
import java.util.TreeMap
import java.util.jar.JarEntry
import java.util.jar.JarOutputStream

/**
 * Builds the loose kit's `R.jar` + `kit.json` from a staged kit dir (`aars/<name>/{R.txt, AndroidManifest.xml, res}`,
 * `classes/<lib>.jar`). AAR R.txt files carry placeholder ids (0x0), so ids are assigned here in one app-wide space,
 * like AGP's final R: the same attr has the same id in every library's R class.
 */
fun main(args: Array<String>) {
    val kitDir = File(args.getOrNull(0) ?: error("usage: LooseKitGen <kitDir> <packageName> <appTheme> <label>"))
    val packageName = args[1]
    val appTheme = args[2]
    val label = args[3]
    val aars = File(kitDir, "aars").listFiles { f -> f.isDirectory }.orEmpty().sortedBy { it.name }
    val libs = aars.mapNotNull { dir ->
        val rTxt = File(dir, "R.txt").takeIf { it.isFile } ?: return@mapNotNull null
        val pkg = Regex("""package="([^"]+)"""").find(File(dir, "AndroidManifest.xml").readText())?.groupValues?.get(1)
            ?: return@mapNotNull null
        pkg to parseRTxt(rTxt.readLines())
    }
    val ids = assignIds(libs.map { it.second })
    val byPackage = TreeMap<String, MutableList<Symbol>>()
    for ((pkg, symbols) in libs) byPackage.getOrPut(pkg) { ArrayList() } += symbols
    byPackage.getOrPut(packageName) { ArrayList() }

    JarOutputStream(File(kitDir, "R.jar").outputStream().buffered()).use { jar ->
        for ((pkg, symbols) in byPackage) writeR(jar, pkg, symbols.distinctBy { it.type to it.name }, ids)
    }

    val classpath = File(kitDir, "classes").listFiles { f -> f.name.endsWith(".jar") }.orEmpty().map { "classes/${it.name}" }.sorted()
    val aarRes = aars.filter { File(it, "res").isDirectory }.map { it.name }
    File(kitDir, "kit.json").writeText(
        buildString {
            append("{\n  \"label\": ${json(label)},\n  \"packageName\": ${json(packageName)},\n  \"appTheme\": ${json(appTheme)},\n")
            append("  \"rJar\": \"R.jar\",\n")
            append("  \"aarRes\": [${aarRes.joinToString(", ") { "{\"dir\": ${json("aars/$it/res")}, \"name\": ${json(it)}}" }}],\n")
            append("  \"classpath\": [${classpath.joinToString(", ") { json(it) }}]\n}\n")
        },
    )
    println("loose kit: ${libs.size} R.txt, ${byPackage.size} R classes, ${aarRes.size} res dirs, ${classpath.size} jars")
}

class Child(val name: String, val index: Int, val fixedId: Int)

class Symbol(val type: String, val name: String, val children: List<Child>? = null, val size: Int = 0)

/** `int[] styleable X {…}` is followed by its `int styleable X_child i` lines; android attrs keep their real ids. */
fun parseRTxt(lines: List<String>): List<Symbol> {
    val out = ArrayList<Symbol>()
    var styleable: String? = null
    var children = ArrayList<Child>()
    var values: List<Int> = emptyList()
    fun close() {
        val s = styleable ?: return
        out += Symbol("styleable", s, children, values.size)
        styleable = null
    }
    for (line in lines) {
        val parts = line.trim().split(' ', limit = 4)
        if (parts.size < 4) continue
        val (kind, type, name, value) = parts
        when {
            kind == "int[]" && type == "styleable" -> {
                close()
                styleable = name
                children = ArrayList()
                values = value.trim().removePrefix("{").removeSuffix("}").split(',').map { it.trim() }.filter { it.isNotEmpty() }
                    .map { java.lang.Long.decode(it).toInt() }
            }
            kind == "int" && type == "styleable" -> {
                val s = styleable ?: continue
                if (!name.startsWith("${s}_")) continue
                val index = value.trim().toInt()
                children += Child(name.removePrefix("${s}_"), index, values.getOrElse(index) { 0 })
            }
            kind == "int" -> {
                close()
                out += Symbol(type, name)
            }
        }
    }
    close()
    return out
}

/** One id per (type, name) across all libraries; per type sorted by name, so styleable arrays stay ascending. */
fun assignIds(libs: List<List<Symbol>>): Map<String, Map<String, Int>> {
    val names = TreeMap<String, java.util.TreeSet<String>>()
    for (lib in libs) for (s in lib) if (s.type != "styleable") names.getOrPut(s.type) { java.util.TreeSet() } += s.name
    var typeId = 1
    return names.mapValues { (_, set) ->
        val base = 0x7f000000 or (typeId++ shl 16)
        set.withIndex().associate { (i, n) -> n to (base + i) }
    }
}

private fun writeR(jar: JarOutputStream, pkg: String, symbols: List<Symbol>, ids: Map<String, Map<String, Int>>) {
    val outer = pkg.replace('.', '/') + "/R"
    val types = symbols.groupBy { it.type }.toSortedMap()
    val cw = ClassWriter(ClassWriter.COMPUTE_MAXS)
    cw.visit(Opcodes.V1_8, Opcodes.ACC_PUBLIC or Opcodes.ACC_FINAL or Opcodes.ACC_SUPER, outer, null, "java/lang/Object", null)
    for (t in types.keys) cw.visitInnerClass("$outer\$$t", outer, t, Opcodes.ACC_PUBLIC or Opcodes.ACC_STATIC or Opcodes.ACC_FINAL)
    cw.visitEnd()
    jar.putNextEntry(JarEntry("$outer.class"))
    jar.write(cw.toByteArray())
    jar.closeEntry()
    for ((type, list) in types) {
        val name = "$outer\$$type"
        val w = ClassWriter(ClassWriter.COMPUTE_MAXS)
        w.visit(Opcodes.V1_8, Opcodes.ACC_PUBLIC or Opcodes.ACC_FINAL or Opcodes.ACC_SUPER, name, null, "java/lang/Object", null)
        w.visitInnerClass(name, outer, type, Opcodes.ACC_PUBLIC or Opcodes.ACC_STATIC or Opcodes.ACC_FINAL)
        val arrays = ArrayList<Pair<String, IntArray>>()
        for (s in list) {
            val children = s.children
            if (children == null) {
                // Non-final, like a library R: a static ConstantValue still initialises the field without <clinit> code.
                w.visitField(Opcodes.ACC_PUBLIC or Opcodes.ACC_STATIC, s.name, "I", null, ids[type]?.get(s.name) ?: 0).visitEnd()
                continue
            }
            val attrs = ids["attr"].orEmpty()
            val values = IntArray(s.size)
            for (c in children) if (c.index in values.indices) values[c.index] = if (c.fixedId != 0) c.fixedId else attrs[c.name] ?: 0
            arrays += s.name to values
            w.visitField(Opcodes.ACC_PUBLIC or Opcodes.ACC_STATIC, s.name, "[I", null, null).visitEnd()
            for (c in children) w.visitField(Opcodes.ACC_PUBLIC or Opcodes.ACC_STATIC, "${s.name}_${c.name}", "I", null, c.index).visitEnd()
        }
        if (arrays.isNotEmpty()) writeArrays(w, name, arrays)
        w.visitEnd()
        jar.putNextEntry(JarEntry("$name.class"))
        jar.write(w.toByteArray())
        jar.closeEntry()
    }
}

/** One helper method per array keeps every method far below the 64 KB limit (Material has ~1800 styleable entries). */
private fun writeArrays(w: ClassWriter, owner: String, arrays: List<Pair<String, IntArray>>) {
    arrays.forEachIndexed { n, (field, values) ->
        val m = w.visitMethod(Opcodes.ACC_PRIVATE or Opcodes.ACC_STATIC, "a$n", "()V", null, null)
        m.visitCode()
        m.visitLdcInsn(values.size)
        m.visitIntInsn(Opcodes.NEWARRAY, Opcodes.T_INT)
        for ((i, v) in values.withIndex()) {
            m.visitInsn(Opcodes.DUP)
            m.visitLdcInsn(i)
            m.visitLdcInsn(v)
            m.visitInsn(Opcodes.IASTORE)
        }
        m.visitFieldInsn(Opcodes.PUTSTATIC, owner, field, "[I")
        m.visitInsn(Opcodes.RETURN)
        m.visitMaxs(0, 0)
        m.visitEnd()
    }
    val clinit = w.visitMethod(Opcodes.ACC_STATIC, "<clinit>", "()V", null, null)
    clinit.visitCode()
    for (n in arrays.indices) clinit.visitMethodInsn(Opcodes.INVOKESTATIC, owner, "a$n", "()V", false)
    clinit.visitInsn(Opcodes.RETURN)
    clinit.visitMaxs(0, 0)
    clinit.visitEnd()
}

private fun json(s: String): String = "\"" + s.replace("\\", "\\\\").replace("\"", "\\\"") + "\""
