package dev.ccm.layoutdaemon

import java.awt.Color
import java.awt.GradientPaint
import java.awt.RenderingHints
import java.awt.geom.Ellipse2D
import java.awt.geom.Path2D
import java.awt.image.BufferedImage
import java.io.File
import java.security.MessageDigest
import kotlin.random.Random

/**
 * Design-time sample data, like Android Studio's: `@tools:sample/<name>[index]` (built-in lists and images) and
 * `@sample/<name>` (the module's `sampledata/` folder). Images are drawn here, not Studio's: generated landscapes and
 * avatars written once as `drawable-nodpi` PNGs into a res dir every project repository includes.
 */
object SampleData {
    const val COUNT = 10
    private const val VERSION = "1"
    private const val MAX_LINES = 200
    private const val MAX_LINE = 500
    private const val MAX_IMAGES = 50
    private val IMAGE_EXT = setOf("png", "jpg", "jpeg", "webp")

    /** Built-in images res dir; null until [init] (or when it failed: image samples then stay unresolved). */
    @Volatile
    var resDir: File? = null
        private set

    @Volatile
    private var projectRoot: File? = null

    fun init(cacheDir: File) {
        projectRoot = File(cacheDir, "sample-project")
        resDir = runCatching { ensureImages(File(cacheDir, "sample-res")) }.getOrNull()
    }

    fun ensureImages(dir: File): File {
        val drawables = File(dir, "drawable-nodpi")
        val marker = File(dir, ".ccm-sample-v$VERSION")
        if (marker.isFile && (drawables.list()?.size ?: 0) >= COUNT * 2) return dir
        drawables.mkdirs()
        for (i in 0 until COUNT) {
            PngWriter.write(scenic(i), File(drawables, "ccm_sample_scenic_$i.png"))
            PngWriter.write(avatar(i), File(drawables, "ccm_sample_avatar_$i.png"))
        }
        marker.writeText("")
        return dir
    }

    private val SKIES = listOf(
        0xFF8EC5FC to 0xFFE0C3FC, 0xFF74B9FF to 0xFFDFF9FB, 0xFFFFB88C to 0xFFFFE29F, 0xFF667EEA to 0xFFF6D365,
        0xFF5EE7DF to 0xFFB490CA, 0xFF2C3E50 to 0xFFFD746C, 0xFF89F7FE to 0xFF66A6FF, 0xFFFAD0C4 to 0xFFFFD1FF,
        0xFF43CEA2 to 0xFF185A9D, 0xFFF093FB to 0xFFF5576C,
    )
    private val HILLS = listOf(0xFF3D5A80, 0xFF2D6A4F, 0xFF6D597A, 0xFF355070, 0xFF40916C, 0xFF1B263B, 0xFF52796F, 0xFF7B2CBF, 0xFF2B9348, 0xFF5E548E)

    private fun color(argb: Long): Color = Color(argb.toInt(), true)

    /** [t] = 0 → [a], 1 → [b]. */
    private fun mix(a: Color, b: Color, t: Float): Color =
        Color((a.red + (b.red - a.red) * t).toInt(), (a.green + (b.green - a.green) * t).toInt(), (a.blue + (b.blue - a.blue) * t).toInt())

    /** Sky gradient, sun, three ridge layers; seeded per index so every render shows the same picture. */
    fun scenic(i: Int, width: Int = 640, height: Int = 400): BufferedImage {
        val img = BufferedImage(width, height, BufferedImage.TYPE_INT_ARGB)
        val g = img.createGraphics()
        try {
            g.setRenderingHint(RenderingHints.KEY_ANTIALIASING, RenderingHints.VALUE_ANTIALIAS_ON)
            val (top, bottom) = SKIES[i % SKIES.size]
            g.paint = GradientPaint(0f, 0f, color(top), 0f, height * 0.7f, color(bottom))
            g.fillRect(0, 0, width, height)
            val rnd = Random(i * 7919 + 17)
            g.color = Color(255, 250, 225, 220)
            val sun = height * (0.12f + rnd.nextFloat() * 0.06f)
            g.fill(Ellipse2D.Float(width * (0.15f + rnd.nextFloat() * 0.6f), height * (0.12f + rnd.nextFloat() * 0.15f), sun, sun))
            val base = HILLS[i % HILLS.size]
            for (layer in 0 until 3) {
                val path = Path2D.Float()
                val horizon = height * (0.45f + layer * 0.14f)
                path.moveTo(0f, height.toFloat())
                path.lineTo(0f, horizon)
                var x = 0f
                while (x < width) {
                    x += width * (0.08f + rnd.nextFloat() * 0.12f)
                    path.lineTo(minOf(x, width.toFloat()), horizon - height * (0.05f + rnd.nextFloat() * (0.22f - layer * 0.05f)))
                }
                path.lineTo(width.toFloat(), height.toFloat())
                path.closePath()
                // Far ridges fade into the sky.
                g.color = mix(color(base), color(bottom), (2 - layer) * 0.3f)
                g.fill(path)
            }
        } finally {
            g.dispose()
        }
        return img
    }

    private val AVATAR_BG = listOf(0xFFE57373, 0xFF64B5F6, 0xFF81C784, 0xFFFFB74D, 0xFFBA68C8, 0xFF4DB6AC, 0xFFF06292, 0xFF7986CB, 0xFFA1887F, 0xFF90A4AE)

    /** Coloured tile with a head-and-shoulders silhouette. */
    fun avatar(i: Int, size: Int = 256): BufferedImage {
        val img = BufferedImage(size, size, BufferedImage.TYPE_INT_ARGB)
        val g = img.createGraphics()
        try {
            g.setRenderingHint(RenderingHints.KEY_ANTIALIASING, RenderingHints.VALUE_ANTIALIAS_ON)
            g.color = color(AVATAR_BG[i % AVATAR_BG.size])
            g.fillRect(0, 0, size, size)
            g.color = Color(255, 255, 255, 215)
            val head = size * 0.36f
            g.fill(Ellipse2D.Float((size - head) / 2f, size * 0.2f, head, head))
            g.fill(Ellipse2D.Float(size * 0.16f, size * 0.62f, size * 0.68f, size * 0.62f))
        } finally {
            g.dispose()
        }
        return img
    }

    private val FIRST = listOf("Alex", "Sam", "Jordan", "Taylor", "Morgan", "Casey", "Riley", "Jamie", "Avery", "Quinn")
    private val LAST = listOf("Nguyen", "Smith", "Garcia", "Kim", "Martin", "Lopez", "Brown", "Tran", "Wilson", "Clark")
    private const val LOREM = "Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat."
    private val LOREM_WORDS = LOREM.split(' ')

    val TEXT: Map<String, List<String>> = mapOf(
        "first_names" to FIRST,
        "last_names" to LAST,
        "full_names" to FIRST.indices.map { "${FIRST[it]} ${LAST[(it * 3) % LAST.size]}" },
        "cities" to listOf("Hanoi", "Lisbon", "Osaka", "Toronto", "Nairobi", "Lima", "Oslo", "Seoul", "Austin", "Prague"),
        "us_zipcodes" to listOf("10001", "94105", "60601", "73301", "98101", "02108", "30301", "33101", "80202", "85001"),
        "us_phones" to listOf("(212) 555-0142", "(415) 555-0178", "(312) 555-0109", "(512) 555-0155", "(206) 555-0123", "(617) 555-0190", "(404) 555-0137", "(305) 555-0164", "(303) 555-0181", "(602) 555-0116"),
        "lorem" to listOf(LOREM),
        "lorem/random" to (0 until COUNT).map { LOREM_WORDS.take(4 + (it * 5) % (LOREM_WORDS.size - 4)).joinToString(" ") },
        "date/day_of_week" to listOf("Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"),
        "date/ddmmyy" to (0 until COUNT).map { "%02d-%02d-%02d".format(1 + it * 3, 1 + it % 12, 20 + it % 6) },
        "date/mmddyy" to (0 until COUNT).map { "%02d-%02d-%02d".format(1 + it % 12, 1 + it * 3, 20 + it % 6) },
        "date/hhmm" to (0 until COUNT).map { "%02d:%02d".format((7 + it * 2) % 24, (it * 13) % 60) },
        "date/hhmmss" to (0 until COUNT).map { "%02d:%02d:%02d".format((7 + it * 2) % 24, (it * 13) % 60, (it * 29) % 60) },
    )

    private val IMAGES = mapOf("avatars" to "ccm_sample_avatar", "backgrounds/scenic" to "ccm_sample_scenic")

    private val TOOLS_REF = Regex("""^@tools:sample/([A-Za-z0-9_/]+)(?:\[(\d{1,4})])?$""")
    private val PROJECT_REF = Regex("""^@sample/([A-Za-z0-9_.\-]+)(?:\[(\d{1,4})])?$""")

    fun isReference(value: String): Boolean = value.startsWith("@tools:sample/") || value.startsWith("@sample/")

    /**
     * `sampledata/` of a module: text files (one item per line; JSON is not supported) and folders of images (copied
     * into a res dir as `ccm_sd_<name>_<i>`). Returns the items per name and that res dir (null without images).
     */
    fun loadProject(dirs: List<File>): Pair<Map<String, List<String>>, File?> {
        val out = LinkedHashMap<String, List<String>>()
        val root = projectRoot ?: return out to null
        val key = MessageDigest.getInstance("SHA-1").digest(dirs.joinToString("\n") { it.absolutePath }.toByteArray()).joinToString("") { "%02x".format(it) }.take(16)
        val res = File(root, key)
        val drawables = File(res, "drawable-nodpi")
        var images = false
        res.deleteRecursively()
        for (dir in dirs.filter { it.isDirectory }) {
            for (f in dir.listFiles().orEmpty().sortedBy { it.name }) {
                if (out.containsKey(f.name)) continue
                if (f.isFile && f.extension.lowercase() != "json" && f.length() < 1_000_000) {
                    out[f.name] = f.readLines().map { it.take(MAX_LINE) }.filter { it.isNotBlank() }.take(MAX_LINES)
                } else if (f.isDirectory) {
                    val safe = f.name.lowercase().replace(Regex("[^a-z0-9_]"), "_")
                    val refs = ArrayList<String>()
                    for ((i, img) in f.listFiles().orEmpty().filter { it.isFile && it.extension.lowercase() in IMAGE_EXT }.sortedBy { it.name }.take(MAX_IMAGES).withIndex()) {
                        drawables.mkdirs()
                        val name = "ccm_sd_${safe}_$i"
                        img.copyTo(File(drawables, "$name.${img.extension.lowercase()}"), overwrite = true)
                        refs += "@drawable/$name"
                        images = true
                    }
                    if (refs.isNotEmpty()) out[f.name] = refs
                }
            }
        }
        return out to if (images) res else null
    }

    /** One render's sample data: each reference without an index takes the next item of its list, like Studio. */
    class Resolver(private val project: Map<String, List<String>> = emptyMap()) {
        private val next = HashMap<String, Int>()

        fun resolve(value: String): String? {
            val v = value.trim()
            TOOLS_REF.matchEntire(v)?.let { m ->
                val name = m.groupValues[1]
                val i = index(name, m.groupValues[2])
                IMAGES[name]?.let { return "@drawable/${it}_${i % COUNT}" }
                return TEXT[name]?.let { it[i % it.size] }
            }
            PROJECT_REF.matchEntire(v)?.let { m ->
                val list = project[m.groupValues[1]]?.takeIf { it.isNotEmpty() } ?: return null
                return list[index("sample:" + m.groupValues[1], m.groupValues[2]) % list.size]
            }
            return null
        }

        private fun index(name: String, explicit: String): Int {
            if (explicit.isNotEmpty()) return explicit.toInt()
            val i = next[name] ?: 0
            next[name] = i + 1
            return i
        }
    }
}
