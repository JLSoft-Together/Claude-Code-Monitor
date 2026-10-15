package dev.ccm.layoutdaemon

import com.google.gson.JsonArray
import com.google.gson.JsonObject
import org.junit.jupiter.api.AfterAll
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertNotNull
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Assumptions.assumeTrue
import org.junit.jupiter.api.BeforeAll
import org.junit.jupiter.api.DynamicTest
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.TestFactory
import org.junit.jupiter.api.TestInstance
import java.awt.image.BufferedImage
import java.io.File
import java.util.Locale
import javax.imageio.ImageIO
import kotlin.math.abs

/**
 * Framework-only layouts and drawables against PNGs recorded on the same host OS (fonts and antialiasing differ
 * between Windows and macOS, so goldens are per OS and a missing set skips). Record: `CCM_GOLDEN_RECORD=1 gradlew test`.
 */
@TestInstance(TestInstance.Lifecycle.PER_CLASS)
class GoldenTest {
    private lateinit var h: RpcHarness
    private val root = File(System.getProperty("golden.dir") ?: error("golden.dir not set"))
    private val record = System.getenv("CCM_GOLDEN_RECORD") == "1"
    private val goldens = File(root, osLabel())
    private val out = File(System.getProperty("golden.out") ?: "build/golden-out")

    @BeforeAll
    fun start() {
        h = RpcHarness()
    }

    @AfterAll
    fun stop() = h.close()

    @TestFactory
    fun layouts(): List<DynamicTest> = File(root, "layouts").listFiles { f -> f.extension == "xml" }!!.sortedBy { it.name }.map { file ->
        DynamicTest.dynamicTest(file.nameWithoutExtension) {
            val name = file.nameWithoutExtension
            val res = h.result("render", JsonObject().apply {
                addProperty("requestId", "g-$name")
                addProperty("layoutPath", "res/layout/$name.xml")
                addProperty("xmlContent", file.readText())
                add("device", device(540, 960, 240))
                when (name) {
                    "theme_light" -> addProperty("theme", "android:Theme.Material.Light.NoActionBar")
                    "theme_night" -> addProperty("night", true)
                }
            })
            assertTrue(RpcHarness.messages(res).none { it.startsWith("Render failed") }, "$name: ${RpcHarness.messages(res)}")
            check("layout-$name", res)
        }
    }

    @Test
    fun shapeGradientHasTransparentRoundedCorners() {
        val res = drawable("shape_gradient")
        val img = check("drawable-shape_gradient", res)
        assertTrue((img.getRGB(0, 0) ushr 24) < 0x80, "corner should be transparent")
        assertTrue((img.getRGB(img.width / 2, img.height / 2) ushr 24) == 0xFF, "centre should be opaque")
    }

    @Test
    fun vector() {
        val img = check("drawable-vector_star", drawable("vector_star"))
        assertEquals(144, img.width)
    }

    @Test
    fun selectorFollowsTheStateChips() {
        val centre = { states: List<String> ->
            val img = ImageIO.read(File(drawable("selector_pressed", states).get("png").asString))
            img.getRGB(img.width / 2, img.height / 2) and 0xFFFFFF
        }
        assertClose(0x42A5F5, centre(emptyList()))
        assertClose(0x1565C0, centre(listOf("pressed")))
        assertClose(0xBDBDBD, centre(listOf("disabled")))
        check("drawable-selector_pressed", drawable("selector_pressed", listOf("pressed")))
    }

    @Test
    fun colorStateListGivesSwatches() {
        val res = drawable("color_list", colorList = true)
        val swatches = res.getAsJsonArray("swatches").associate { it.asJsonObject.get("state").asString to it.asJsonObject.get("color").asString }
        assertEquals("#FF2196F3", swatches["default"])
        assertEquals("#FF0D47A1", swatches["pressed"])
        assertEquals("#61000000", swatches["disabled"])
        assertTrue(res.get("png").isJsonNull)
    }

    @Test
    fun unresolvedColorIsADiagnosticNotAGuess() {
        val res = drawable("unresolved_color")
        val messages = RpcHarness.messages(res)
        assertTrue(messages.any { "brand_primary" in it }, "$messages")
    }

    private fun drawable(name: String, states: List<String> = emptyList(), colorList: Boolean = false): JsonObject =
        h.result("drawable/render", JsonObject().apply {
            addProperty("requestId", "d-$name-${states.joinToString("-")}")
            addProperty("path", "res/drawable/$name.xml")
            addProperty("xmlContent", File(root, "drawables/$name.xml").readText())
            add("device", device(144, 144, 480))
            add("states", JsonArray().also { a -> states.forEach(a::add) })
            addProperty("colorList", colorList)
        })

    private fun device(w: Int, h: Int, dpi: Int) = JsonObject().apply {
        addProperty("width", w)
        addProperty("height", h)
        addProperty("density", dpi)
    }

    private fun check(name: String, res: JsonObject): BufferedImage {
        val png = res.get("png")?.takeUnless { it.isJsonNull }?.asString
        assertNotNull(png, "$name: no image, ${RpcHarness.messages(res)}")
        val actual = ImageIO.read(File(png!!))
        val golden = File(goldens, "$name.png")
        if (record) {
            goldens.mkdirs()
            ImageIO.write(actual, "png", golden)
            return actual
        }
        assumeTrue(golden.isFile, "no golden for ${osLabel()} (host OS only): $golden")
        val expected = ImageIO.read(golden)
        out.mkdirs()
        val diff = diffRatio(expected, actual)
        if (diff > MAX_DIFF_RATIO) ImageIO.write(actual, "png", File(out, "$name.png"))
        assertTrue(diff <= MAX_DIFF_RATIO, "$name differs from the golden in ${"%.2f".format(diff * 100)}% of pixels (actual in $out)")
        return actual
    }

    private fun diffRatio(a: BufferedImage, b: BufferedImage): Double {
        if (a.width != b.width || a.height != b.height) return 1.0
        var bad = 0
        for (y in 0 until a.height) for (x in 0 until a.width) {
            val p = a.getRGB(x, y)
            val q = b.getRGB(x, y)
            if ((0..24 step 8).any { s -> abs(((p ushr s) and 0xFF) - ((q ushr s) and 0xFF)) > CHANNEL_TOLERANCE }) bad++
        }
        return bad.toDouble() / (a.width * a.height)
    }

    private fun assertClose(expected: Int, actual: Int) {
        val ok = (0..16 step 8).all { s -> abs(((expected ushr s) and 0xFF) - ((actual ushr s) and 0xFF)) <= CHANNEL_TOLERANCE }
        assertTrue(ok, "expected #%06X, got #%06X".format(expected, actual))
    }

    private companion object {
        const val CHANNEL_TOLERANCE = 16
        const val MAX_DIFF_RATIO = 0.005

        fun osLabel(): String = System.getProperty("os.name").lowercase(Locale.US).let {
            when {
                it.startsWith("windows") -> "win"
                it.startsWith("mac") -> "mac"
                else -> "linux"
            }
        }
    }
}
