package dev.ccm.layoutdaemon

import com.google.gson.JsonArray
import com.google.gson.JsonObject
import dev.ccm.layoutdaemon.RpcHarness.Companion.flatten
import dev.ccm.layoutdaemon.RpcHarness.Companion.messages
import dev.ccm.layoutdaemon.RpcHarness.Companion.strings
import org.junit.jupiter.api.AfterAll
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.BeforeAll
import org.junit.jupiter.api.MethodOrderer
import org.junit.jupiter.api.Order
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.TestInstance
import org.junit.jupiter.api.TestMethodOrder
import java.io.File
import java.nio.file.Files
import javax.imageio.ImageIO
import kotlin.math.abs

@TestInstance(TestInstance.Lifecycle.PER_CLASS)
@TestMethodOrder(MethodOrderer.OrderAnnotation::class)
class ProjectCacheTest {
    private lateinit var rpc: RpcHarness
    private lateinit var root: File
    private lateinit var mainXml: String
    private val apps = HashMap<String, File>()

    // Distinct tools:context activity colour per project so a render shows whose resources are active.
    private val colors = mapOf("a" to 0x993366, "b" to 0x2266CC, "c" to 0x44AA22, "d" to 0xCC8800)

    @BeforeAll
    fun start() {
        rpc = RpcHarness()
        val fixture = File(javaClass.getResource("/fixture-app/res/layout/main.xml")!!.toURI()).parentFile.parentFile.parentFile
        root = Files.createTempDirectory("fixture-cache").toFile()
        for ((name, color) in colors) {
            val dir = File(root, name)
            fixture.copyRecursively(dir, overwrite = true)
            val values = File(dir, "res/values/values.xml")
            values.writeText(values.readText().replace("#FF993366", "#FF%06X".format(color)))
            apps[name] = dir
        }
        mainXml = File(apps.getValue("a"), "res/layout/main.xml").readText()
    }

    @AfterAll
    fun stop() {
        rpc.close()
        root.deleteRecursively()
    }

    private fun params(app: String, id: String?, classesChanged: Boolean = false) = JsonObject().apply {
        val dir = apps.getValue(app)
        add("resDirs", strings(listOf(File(dir, "res").path)))
        add("aarResDirs", JsonArray().apply {
            add(JsonObject().apply {
                addProperty("dir", File(dir, "lib-res/res").path)
                addProperty("name", "fixture-lib")
            })
        })
        add("classpath", strings(System.getProperty("fixture.classes")!!.split(File.pathSeparator)))
        addProperty("packageName", "dev.ccm.fixture")
        addProperty("appTheme", "@style/Theme.Fixture")
        add("activityThemes", JsonObject().apply { addProperty("dev.ccm.fixture.DetailActivity", "@style/Theme.Fixture.Detail") })
        if (id != null) addProperty("projectId", id)
        if (classesChanged) addProperty("classesChanged", true)
    }

    private fun load(app: String, id: String? = app, classesChanged: Boolean = false) =
        rpc.result("project/load", params(app, id, classesChanged))

    private fun assertRendersAs(app: String) {
        val res = rpc.render(mainXml)
        val actual = ImageIO.read(File(res.get("png").asString)).getRGB(1070, 2330) and 0xFFFFFF
        val expected = colors.getValue(app)
        val close = (0..2).all { i -> abs(((expected shr (i * 8)) and 0xFF) - ((actual shr (i * 8)) and 0xFF)) <= 3 }
        assertTrue(close, "$app: expected #%06X got #%06X".format(expected, actual))
        val badge = flatten(res.getAsJsonObject("viewTree")).first { it.get("xmlId")?.takeUnless { e -> e.isJsonNull }?.asString == "@+id/badge" }
        assertEquals("dev.ccm.fixture.BadgeView", badge.get("class").asString, "${messages(res)}")
    }

    @Test
    @Order(1)
    fun `switching back to a cached project reuses it without a new loader`() {
        val a = load("a")
        assertFalse(a.get("reused").asBoolean)
        assertEquals(1, a.get("cached").asInt)
        assertRendersAs("a")

        val b = load("b")
        assertFalse(b.get("reused").asBoolean)
        assertEquals(2, b.get("cached").asInt)
        assertRendersAs("b")
        assertEquals(2, rpc.renderer.loadersCreated)

        val again = load("a")
        assertTrue(again.get("reused").asBoolean, "$again")
        assertEquals(2, again.get("cached").asInt)
        assertEquals(2, rpc.renderer.loadersCreated)
        assertRendersAs("a")
    }

    @Test
    @Order(2)
    fun `classesChanged on a reused project creates a new loader`() {
        load("b")
        val r = load("a", classesChanged = true)
        assertTrue(r.get("reused").asBoolean)
        assertEquals(3, rpc.renderer.loadersCreated)
        assertRendersAs("a")
    }

    @Test
    @Order(3)
    fun `a fourth project evicts the least recently used one`() {
        load("c")
        val d = load("d")
        assertEquals(LayoutRenderer.MAX_CACHED_PROJECTS, d.get("cached").asInt)
        assertRendersAs("d")
        // LRU order before d: b, a, c → b is gone.
        val b = load("b")
        assertFalse(b.get("reused").asBoolean, "$b")
        assertEquals(LayoutRenderer.MAX_CACHED_PROJECTS, b.get("cached").asInt)
        assertRendersAs("b")
    }

    @Test
    @Order(4)
    fun `empty load deactivates but keeps the cache`() {
        val empty = rpc.result("project/load", JsonObject())
        assertTrue(empty.get("frameworkOnly").asBoolean)
        assertEquals(LayoutRenderer.MAX_CACHED_PROJECTS, empty.get("cached").asInt)
        assertTrue(messages(rpc.render(mainXml)).any { "Class not found: dev.ccm.fixture.BadgeView" in it })

        val b = load("b")
        assertTrue(b.get("reused").asBoolean, "$b")
        assertRendersAs("b")
    }

    @Test
    @Order(5)
    fun `same id with a different spec reloads and anonymous loads keep the old behaviour`() {
        val swapped = load("c", id = "b")
        assertFalse(swapped.get("reused").asBoolean)
        assertRendersAs("c")

        val before = rpc.renderer.loadersCreated
        val anon = load("d", id = null)
        assertFalse(anon.get("reused").asBoolean)
        assertRendersAs("d")
        val anonAgain = load("d", id = null)
        assertFalse(anonAgain.get("reused").asBoolean)
        assertEquals(before + 2, rpc.renderer.loadersCreated)
        assertTrue(anonAgain.get("cached").asInt <= LayoutRenderer.MAX_CACHED_PROJECTS)
    }
}
