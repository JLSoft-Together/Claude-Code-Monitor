package dev.ccm.layoutdaemon

import com.google.gson.JsonArray
import com.google.gson.JsonObject
import java.io.File
import java.nio.file.Files
import java.util.concurrent.LinkedBlockingQueue
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicInteger

/** In-process RpcServer driven like the IDE drives the daemon (same JSON, no framing). */
class RpcHarness {
    private val messages = LinkedBlockingQueue<JsonObject>()
    private val ids = AtomicInteger()
    val cacheDir: File = Files.createTempDirectory("layout-daemon-test").toFile()
    val server: RpcServer
    val renderer: LayoutRenderer

    init {
        LogCapture.install()
        val dir = File(System.getProperty("layoutlib.dir") ?: error("layoutlib.dir not set"))
        renderer = LayoutRenderer(dir)
        server = RpcServer(renderer, send = { messages.put(it) })
        val init = call("initialize", JsonObject().apply {
            addProperty("protocolVersion", 1)
            addProperty("cacheDir", cacheDir.path)
        }, timeoutSec = 120)
        init.getAsJsonObject("result") ?: error("initialize failed: $init")
    }

    fun close() {
        server.worker.shutdownNow()
        cacheDir.deleteRecursively()
    }

    fun call(method: String, params: JsonObject, timeoutSec: Long = 120): JsonObject {
        val id = ids.incrementAndGet()
        server.handleText(JsonObject().apply {
            addProperty("jsonrpc", "2.0")
            addProperty("id", id)
            addProperty("method", method)
            add("params", params)
        }.toString())
        val deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(timeoutSec)
        while (true) {
            val left = deadline - System.nanoTime()
            val m = messages.poll(maxOf(left, 0), TimeUnit.NANOSECONDS) ?: error("timeout waiting for $method #$id")
            if (m.get("id")?.takeUnless { it.isJsonNull }?.asInt == id) return m
        }
    }

    fun result(method: String, params: JsonObject, timeoutSec: Long = 120): JsonObject {
        val res = call(method, params, timeoutSec)
        return res.getAsJsonObject("result") ?: error("$method failed: $res")
    }

    fun render(xml: String, theme: String? = null, night: Boolean = false): JsonObject = result("render", JsonObject().apply {
        addProperty("requestId", "r${ids.get() + 1}")
        addProperty("layoutPath", "res/layout/test.xml")
        addProperty("xmlContent", xml)
        add("device", JsonObject().apply {
            addProperty("width", 1080)
            addProperty("height", 2340)
            addProperty("density", 440)
        })
        if (theme != null) addProperty("theme", theme)
        addProperty("night", night)
    })

    companion object {
        fun flatten(node: JsonObject): List<JsonObject> =
            listOf(node) + node.getAsJsonArray("children").flatMap { flatten(it.asJsonObject) }

        fun strings(values: Iterable<String>) = JsonArray().also { a -> values.forEach(a::add) }

        fun messages(res: JsonObject): List<String> =
            res.getAsJsonArray("diagnostics").map { it.asJsonObject.get("message").asString }
    }
}
