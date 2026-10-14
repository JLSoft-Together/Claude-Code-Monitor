package dev.ccm.layoutdaemon

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
class ProjectTest {
    private lateinit var rpc: RpcHarness
    private lateinit var app: File
    private lateinit var mainXml: String

    @BeforeAll
    fun start() {
        rpc = RpcHarness()
        val fixture = File(javaClass.getResource("/fixture-app/res/layout/main.xml")!!.toURI()).parentFile.parentFile.parentFile
        app = Files.createTempDirectory("fixture-app").toFile()
        fixture.copyRecursively(app, overwrite = true)
        mainXml = File(app, "res/layout/main.xml").readText()
    }

    @AfterAll
    fun stop() {
        rpc.close()
        app.deleteRecursively()
    }

    private fun loadParams() = JsonObject().apply {
        add("resDirs", strings(listOf(File(app, "res").path)))
        add("aarResDirs", com.google.gson.JsonArray().apply {
            add(JsonObject().apply {
                addProperty("dir", File(app, "lib-res/res").path)
                addProperty("name", "fixture-lib")
            })
        })
        add("classpath", strings(System.getProperty("fixture.classes")!!.split(File.pathSeparator)))
        addProperty("packageName", "dev.ccm.fixture")
        addProperty("namespace", "dev.ccm.fixture")
        addProperty("appTheme", "@style/Theme.Fixture")
        add("activityThemes", JsonObject().apply { addProperty("dev.ccm.fixture.DetailActivity", "@style/Theme.Fixture.Detail") })
        addProperty("minSdk", 24)
        addProperty("targetSdk", 36)
    }

    private fun pixel(res: JsonObject, x: Int, y: Int): Int = ImageIO.read(File(res.get("png").asString)).getRGB(x, y) and 0xFFFFFF

    private fun assertColor(expected: Int, actual: Int) {
        val close = (0..2).all { i -> abs(((expected shr (i * 8)) and 0xFF) - ((actual shr (i * 8)) and 0xFF)) <= 3 }
        assertTrue(close, "expected #%06X got #%06X".format(expected, actual))
    }

    private fun node(res: JsonObject, id: String) = flatten(res.getAsJsonObject("viewTree")).first { it.get("xmlId")?.takeUnless { e -> e.isJsonNull }?.asString == id }

    private fun bounds(n: JsonObject) = n.getAsJsonArray("bounds").map { it.asInt }

    @Test
    @Order(1)
    fun `framework-only render asks for a build`() {
        val res = rpc.render(mainXml)
        val msgs = messages(res)
        assertTrue(msgs.any { "Class not found: dev.ccm.fixture.BadgeView" in it && "build the project" in it }, "$msgs")
        val themed = messages(rpc.render(mainXml, theme = "@style/Theme.Fixture"))
        assertTrue(themed.any { "Theme.Fixture" in it && "build the project" in it }, "$themed")
    }

    @Test
    @Order(2)
    fun `project load renders project resources, custom views and the tools-context theme`() {
        val load = rpc.result("project/load", loadParams())
        assertTrue(load.get("ok").asBoolean)
        assertFalse(load.get("frameworkOnly").asBoolean, "$load")
        assertEquals(2, load.get("resCount").asInt)
        assertTrue(load.get("rIds").asInt >= 10, "$load")
        println("project/load=$load")

        val res = rpc.render(mainXml)
        val msgs = messages(res)
        println("render renderMs=${res.get("renderMs")} timings=${res.get("timings")} diags=$msgs")
        assertColor(0x993366, pixel(res, 1070, 2330))

        val badge = node(res, "@+id/badge")
        assertEquals("dev.ccm.fixture.BadgeView", badge.get("class").asString)
        val b = bounds(badge)
        assertEquals(132, b[2] - b[0], "@dimen/lib_badge_size from the AAR res")
        assertColor(0x22AA44, pixel(res, (b[0] + b[2]) / 2, (b[1] + b[3]) / 2))

        val crash = node(res, "@+id/crash")
        assertEquals("dev.ccm.fixture.CrashingView", crash.get("class").asString)
        assertTrue(msgs.any { "CrashingView failed to render" in it && "isInEditMode" in it }, "$msgs")
        assertTrue(msgs.any { "Class not found: dev.ccm.fixture.NotBuiltView" in it && "project model" in it }, "$msgs")
        assertFalse(msgs.any { "BadgeView" in it }, "$msgs")

        val designTime = bounds(node(res, "@+id/designTime"))
        val greeting = bounds(node(res, "@+id/greeting"))
        assertTrue(designTime[2] - designTime[0] > greeting[2] - greeting[0], "tools:text/tools:visibility applied: $designTime vs $greeting")
    }

    @Test
    @Order(3)
    fun `theme falls back to the app theme and an explicit theme wins`() {
        val noContext = mainXml.replace("tools:context=\".DetailActivity\"", "")
        assertColor(0x336699, pixel(rpc.render(noContext), 1070, 2330))
        assertColor(0x336699, pixel(rpc.render(mainXml, theme = "@style/Theme.Fixture"), 1070, 2330))
    }

    @Test
    @Order(4)
    fun `res change refreshes resources without reloading classes`() {
        val before = bounds(node(rpc.render(mainXml), "@+id/greeting"))
        val values = File(app, "res/values/values.xml")
        values.writeText(values.readText().replace("Hello fixture", "Hello fixture, now with a much longer greeting"))
        val changed = rpc.result("project/changed", JsonObject().apply {
            addProperty("kind", "res")
            add("files", strings(listOf(values.path)))
        })
        assertFalse(changed.get("restartSuggested").asBoolean)
        println("project/changed res=$changed")
        val after = bounds(node(rpc.render(mainXml), "@+id/greeting"))
        assertTrue(after[2] - after[0] > before[2] - before[0], "$before -> $after")
    }

    @Test
    @Order(5)
    fun `class reloads keep rendering and eventually suggest a restart`() {
        var suggested = false
        repeat(LayoutRenderer.MAX_PROJECT_LOADERS) {
            val r = rpc.result("project/changed", JsonObject().apply { addProperty("kind", "classes") })
            suggested = r.get("restartSuggested").asBoolean
        }
        assertTrue(suggested)
        val res = rpc.render(mainXml)
        assertEquals("dev.ccm.fixture.BadgeView", node(res, "@+id/badge").get("class").asString)
    }

    @Test
    @Order(6)
    fun `empty project load goes back to framework-only`() {
        val res = rpc.result("project/load", JsonObject())
        assertTrue(res.get("frameworkOnly").asBoolean)
        val bad = rpc.call("project/changed", JsonObject().apply { addProperty("kind", "nope") })
        assertEquals(ErrorCodes.INVALID_PARAMS, bad.getAsJsonObject("error").get("code").asInt)
    }
}
