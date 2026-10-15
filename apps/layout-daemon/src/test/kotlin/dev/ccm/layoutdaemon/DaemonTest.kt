package dev.ccm.layoutdaemon

import com.google.gson.JsonObject
import com.google.gson.JsonParser
import org.junit.jupiter.api.AfterAll
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertNotNull
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.BeforeAll
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.TestInstance
import java.io.File
import java.nio.file.Files
import java.util.concurrent.CountDownLatch
import java.util.concurrent.LinkedBlockingQueue
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicInteger
import javax.imageio.ImageIO

@TestInstance(TestInstance.Lifecycle.PER_CLASS)
class DaemonTest {
    private val messages = LinkedBlockingQueue<JsonObject>()
    private val ids = AtomicInteger()
    private lateinit var server: RpcServer
    private lateinit var cacheDir: File

    @BeforeAll
    fun start() {
        LogCapture.install()
        cacheDir = Files.createTempDirectory("layout-daemon-test").toFile()
        val dir = File(System.getProperty("layoutlib.dir") ?: error("layoutlib.dir not set"))
        server = RpcServer(LayoutRenderer(dir), send = { messages.put(it) })
        val init = call("initialize", JsonObject().apply {
            addProperty("protocolVersion", 1)
            addProperty("cacheDir", cacheDir.path)
        }, timeoutSec = 120)
        val result = init.getAsJsonObject("result") ?: error("initialize failed: $init")
        assertEquals(36, result.get("apiLevel").asInt)
        assertEquals("16.2.3", result.get("layoutlibVersion").asString)
        println("initMs=${result.get("initMs")}")
    }

    @AfterAll
    fun stop() {
        server.worker.shutdownNow()
        cacheDir.deleteRecursively()
    }

    private fun call(method: String, params: JsonObject, timeoutSec: Long = 60): JsonObject {
        val id = ids.incrementAndGet()
        send(id, method, params)
        return await(id, timeoutSec)
    }

    private fun send(id: Int, method: String, params: JsonObject) {
        server.handleText(JsonObject().apply {
            addProperty("jsonrpc", "2.0")
            addProperty("id", id)
            addProperty("method", method)
            add("params", params)
        }.toString())
    }

    private fun await(id: Int, timeoutSec: Long = 60): JsonObject {
        val deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(timeoutSec)
        val skipped = ArrayList<JsonObject>()
        try {
            while (true) {
                val left = deadline - System.nanoTime()
                val m = messages.poll(maxOf(left, 0), TimeUnit.NANOSECONDS) ?: error("timeout waiting for $id")
                if (m.get("id")?.takeUnless { it.isJsonNull }?.asInt == id) return m
                if (m.has("id")) skipped += m
            }
        } finally {
            skipped.forEach(messages::put)
        }
    }

    private fun renderParams(xml: String, requestId: String = "r${ids.get() + 1}") = JsonObject().apply {
        addProperty("requestId", requestId)
        addProperty("layoutPath", "res/layout/test.xml")
        addProperty("xmlContent", xml)
        add("device", JsonObject().apply {
            addProperty("width", 1080)
            addProperty("height", 2340)
            addProperty("density", 440)
        })
        addProperty("theme", "android:Theme.Material.Light.NoActionBar")
        addProperty("night", false)
        addProperty("locale", "en")
    }

    private fun flatten(node: JsonObject): List<JsonObject> =
        listOf(node) + node.getAsJsonArray("children").flatMap { flatten(it.asJsonObject) }

    @Test
    fun `framework layout renders with view tree positioned at the opening tag`() {
        val res = call("render", renderParams(FRAMEWORK_XML)).getAsJsonObject("result")
        val png = File(res.get("png").asString)
        assertTrue(png.isFile, "png written")
        val img = ImageIO.read(png)
        assertEquals(1080, img.width)
        assertEquals(2340, img.height)
        assertEquals(1080, res.get("width").asInt)

        val nodes = flatten(res.getAsJsonObject("viewTree"))
        assertEquals(listOf("android.widget.LinearLayout", "android.widget.TextView", "android.widget.TextView", "android.widget.Button"), nodes.map { it.get("class").asString })
        assertEquals(listOf(2, 9, 18, 25), nodes.map { it.get("line").asInt })
        assertEquals(listOf(1, 5, 5, 5), nodes.map { it.get("column").asInt })
        assertEquals("@+id/title", nodes[1].get("xmlId").asString)
        assertTrue(nodes[2].get("xmlId").isJsonNull)
        val rootBounds = nodes[0].getAsJsonArray("bounds").map { it.asInt }
        assertEquals(listOf(0, 0, 1080, 2340), rootBounds)
        val button = nodes[3].getAsJsonArray("bounds").map { it.asInt }
        assertTrue(button[0] > 0 && button[1] > 0 && button[2] > button[0] && button[3] > button[1], "button bounds $button")
        assertTrue(res.getAsJsonArray("diagnostics").none { it.asJsonObject.get("severity").asString == "error" }, "no errors: ${res.get("diagnostics")}")
        println("renderMs=${res.get("renderMs")} timings=${res.get("timings")}")
    }

    @Test
    fun `scaled render draws fewer pixels with the same device geometry`() {
        val full = call("render", renderParams(FRAMEWORK_XML)).getAsJsonObject("result")
        val half = call("render", renderParams(FRAMEWORK_XML).apply { addProperty("scale", 0.5) }).getAsJsonObject("result")
        val img = ImageIO.read(File(half.get("png").asString))
        assertEquals(540, img.width)
        assertEquals(1170, img.height)
        assertEquals(1080, half.get("width").asInt)
        assertEquals(2340, half.get("height").asInt)
        assertEquals(540, half.get("imageWidth").asInt)
        val bounds = { r: JsonObject -> flatten(r.getAsJsonObject("viewTree")).map { n -> n.getAsJsonArray("bounds").map { it.asInt } } }
        assertEquals(bounds(full), bounds(half), "view tree stays in device px")
        // The button is drawn where the tree says, at half size: not the blank background.
        val button = bounds(half).last()
        val cx = (button[0] + button[2]) / 4
        val cy = (button[1] + button[3]) / 4
        val bg = img.getRGB(2, img.height - 3)
        assertTrue(img.getRGB(cx, cy) != bg, "button pixels at its scaled bounds")
    }

    @Test
    fun `warm render timings`() {
        val times = (1..10).map {
            call("render", renderParams(FRAMEWORK_XML)).getAsJsonObject("result")
        }
        println("warm renderMs=" + times.map { it.get("renderMs").asInt } + " timings=" + times.last().get("timings"))
    }

    @Test
    fun `broken xml becomes a diagnostic and the daemon keeps working`() {
        val broken = """
            <LinearLayout xmlns:android="http://schemas.android.com/apk/res/android"
                android:layout_width="match_parent"
                android:layout_height="match_parent">
                <TextView android:text="oops"
            </LinearLayout>
        """.trimIndent()
        val res = call("render", renderParams(broken)).getAsJsonObject("result")
        assertNotNull(res, "still a result")
        val diags = res.getAsJsonArray("diagnostics").map { it.asJsonObject }
        assertTrue(diags.any { it.get("severity").asString == "error" && it.has("line") }, "diagnostic with line: $diags")
        println("broken diags=$diags")

        val ok = call("render", renderParams(FRAMEWORK_XML)).getAsJsonObject("result")
        assertNotNull(ok.get("png").takeUnless { it.isJsonNull })
    }

    @Test
    fun `unknown class renders a placeholder with a diagnostic`() {
        val xml = """
            <LinearLayout xmlns:android="http://schemas.android.com/apk/res/android"
                android:layout_width="match_parent"
                android:layout_height="match_parent"
                android:orientation="vertical">
                <TextView android:layout_width="wrap_content" android:layout_height="wrap_content" android:text="before" />
                <com.example.MissingView
                    android:id="@+id/custom"
                    android:layout_width="match_parent"
                    android:layout_height="120dp" />
                <FancyWidget android:layout_width="match_parent" android:layout_height="40dp" />
            </LinearLayout>
        """.trimIndent()
        val res = call("render", renderParams(xml)).getAsJsonObject("result")
        assertNotNull(res.get("png").takeUnless { it.isJsonNull }, "image still produced")
        val diags = res.getAsJsonArray("diagnostics").map { it.asJsonObject }
        val missing = diags.first { it.get("message").asString.contains("com.example.MissingView") }
        assertEquals(6, missing.get("line").asInt)
        assertTrue(diags.any { it.get("message").asString.contains("FancyWidget") && it.get("line").asInt == 10 }, "short unknown name: $diags")
        val nodes = flatten(res.getAsJsonObject("viewTree"))
        val custom = nodes.first { it.get("class").asString == "com.example.MissingView" }
        assertEquals("@+id/custom", custom.get("xmlId").asString)
        assertEquals(6, custom.get("line").asInt)
        val b = custom.getAsJsonArray("bounds").map { it.asInt }
        assertEquals(1080, b[2] - b[0])
        assertEquals(330, b[3] - b[1])
    }

    @Test
    fun `merge root and config changes render`() {
        val xml = """
            <merge xmlns:android="http://schemas.android.com/apk/res/android">
                <TextView android:layout_width="wrap_content" android:layout_height="wrap_content" android:text="مرحبا" />
            </merge>
        """.trimIndent()
        val params = renderParams(xml).apply {
            add("device", JsonObject().apply {
                addProperty("width", 720)
                addProperty("height", 1280)
                addProperty("density", 320)
            })
            addProperty("night", true)
            addProperty("locale", "ar")
            addProperty("theme", "@android:style/Theme.DeviceDefault.DayNight")
        }
        val res = call("render", params).getAsJsonObject("result")
        assertEquals(720, res.get("width").asInt)
        assertEquals(1280, res.get("height").asInt)
        val tree = res.getAsJsonObject("viewTree")
        assertEquals("merge", tree.get("class").asString)
        assertEquals("android.widget.TextView", tree.getAsJsonArray("children")[0].asJsonObject.get("class").asString)
        println("config change renderMs=${res.get("renderMs")} timings=${res.get("timings")} diags=${res.get("diagnostics")}")
    }

    @Test
    fun `cancel drops a queued render`() {
        val gate = CountDownLatch(1)
        server.worker.execute { gate.await(30, TimeUnit.SECONDS) }
        val id = ids.incrementAndGet()
        send(id, "render", renderParams(FRAMEWORK_XML, requestId = "queued-$id"))
        val cancel = call("cancel", JsonObject().apply { addProperty("requestId", "queued-$id") })
        assertTrue(cancel.getAsJsonObject("result").get("cancelled").asBoolean)
        gate.countDown()
        val res = await(id)
        assertNull(res.get("result"))
        assertEquals(ErrorCodes.REQUEST_CANCELLED, res.getAsJsonObject("error").get("code").asInt)

        val late = call("cancel", JsonObject().apply { addProperty("requestId", "queued-$id") })
        assertTrue(!late.getAsJsonObject("result").get("cancelled").asBoolean)
    }

    @Test
    fun `animated progress bar survives repeated renders`() {
        val xml = """
            <FrameLayout xmlns:android="http://schemas.android.com/apk/res/android" android:layout_width="match_parent" android:layout_height="match_parent">
                <ProgressBar android:layout_width="20dp" android:layout_height="20dp" android:indeterminate="true" />
            </FrameLayout>
        """.trimIndent()
        repeat(3) { assertNotNull(call("render", renderParams(xml)).getAsJsonObject("result").get("png").takeUnless { it.isJsonNull }) }
    }

    @Test
    fun `framing round trips`() {
        val out = java.io.ByteArrayOutputStream()
        Framing.write(out, """{"a":"ä"}""")
        val back = Framing.read(out.toByteArray().inputStream())
        assertEquals("ä", JsonParser.parseString(back).asJsonObject.get("a").asString)
    }

    @Test
    fun `project methods are accepted framework-only`() {
        val res = call("project/load", JsonObject()).getAsJsonObject("result")
        assertTrue(res.get("ok").asBoolean)
        assertTrue(res.get("frameworkOnly").asBoolean)
    }

    companion object {
        val FRAMEWORK_XML = """
<?xml version="1.0" encoding="utf-8"?>
<LinearLayout xmlns:android="http://schemas.android.com/apk/res/android"
    android:layout_width="match_parent"
    android:layout_height="match_parent"
    android:orientation="vertical"
    android:padding="24dp"
    android:background="#FFF5F5F7">

    <TextView
        android:id="@+id/title"
        android:layout_width="wrap_content"
        android:layout_height="wrap_content"
        android:text="Agent Monitor layout daemon"
        android:textSize="22sp"
        android:textStyle="bold"
        android:textColor="#FF1D1D1F" />

    <TextView
        android:layout_width="match_parent"
        android:layout_height="wrap_content"
        android:layout_marginTop="8dp"
        android:text="Framework-only layout — Xin chào!"
        android:textSize="15sp" />

    <Button
        android:id="@+id/save"
        android:layout_width="wrap_content"
        android:layout_height="wrap_content"
        android:layout_marginTop="16dp"
        android:text="Save" />
</LinearLayout>
""".trimStart('\n')
    }
}
