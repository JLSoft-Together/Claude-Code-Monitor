package dev.ccm.layoutdaemon

import com.google.gson.Gson
import com.google.gson.GsonBuilder
import com.google.gson.JsonArray
import com.google.gson.JsonElement
import com.google.gson.JsonNull
import com.google.gson.JsonObject
import com.google.gson.JsonParser
import java.io.File
import java.io.InputStream
import java.io.OutputStream
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors

const val PROTOCOL_VERSION = 1

object ErrorCodes {
    const val PARSE_ERROR = -32700
    const val INVALID_REQUEST = -32600
    const val METHOD_NOT_FOUND = -32601
    const val INVALID_PARAMS = -32602
    const val INTERNAL_ERROR = -32603
    const val NOT_INITIALIZED = -32002
    const val REQUEST_CANCELLED = -32800
}

private class RpcError(val code: Int, message: String) : Exception(message)

/** LSP-style `Content-Length` framing. */
object Framing {
    fun read(input: InputStream): String? {
        var length = -1
        val header = StringBuilder()
        while (true) {
            header.setLength(0)
            while (true) {
                val b = input.read()
                if (b < 0) return null
                if (b == '\n'.code) break
                if (b != '\r'.code) header.append(b.toChar())
            }
            if (header.isEmpty()) {
                if (length >= 0) break
                continue
            }
            val colon = header.indexOf(":")
            if (colon > 0 && header.substring(0, colon).trim().equals("Content-Length", ignoreCase = true)) {
                length = header.substring(colon + 1).trim().toIntOrNull() ?: -1
            }
        }
        val body = input.readNBytes(length)
        if (body.size < length) return null
        return String(body, Charsets.UTF_8)
    }

    fun write(out: OutputStream, json: String) {
        val body = json.toByteArray(Charsets.UTF_8)
        out.write("Content-Length: ${body.size}\r\n\r\n".toByteArray(Charsets.US_ASCII))
        out.write(body)
        out.flush()
    }
}

/**
 * JSON-RPC dispatcher. All layoutlib work runs on one worker thread (layoutlib keeps per-thread
 * Looper/RenderAction state); the reader thread only parses, queues and handles `cancel`.
 */
class RpcServer(
    private val renderer: LayoutRenderer,
    private val send: (JsonObject) -> Unit,
    private val onExit: () -> Unit = {},
) {
    val worker: ExecutorService = Executors.newSingleThreadExecutor { r -> Thread(r, "layoutlib").apply { isDaemon = true } }
    private val queued = ConcurrentHashMap.newKeySet<String>()
    private val cancelled = ConcurrentHashMap.newKeySet<String>()
    private val gson: Gson = GsonBuilder().disableHtmlEscaping().serializeNulls().create()

    init {
        LogCapture.sink = { level, message -> notify("log", JsonObject().apply { addProperty("level", level); addProperty("message", message) }) }
    }

    fun serve(input: InputStream) {
        while (true) {
            val text = Framing.read(input) ?: break
            handleText(text)
        }
        onExit()
    }

    fun handleText(text: String) {
        val msg = try {
            JsonParser.parseString(text).asJsonObject
        } catch (e: Exception) {
            respondError(JsonNull.INSTANCE, ErrorCodes.PARSE_ERROR, "Parse error: ${e.message}")
            return
        }
        handle(msg)
    }

    fun handle(msg: JsonObject) {
        val id: JsonElement? = msg.get("id")?.takeUnless { it.isJsonNull }
        val method = msg.get("method")?.takeIf { it.isJsonPrimitive }?.asString
        if (method == null) {
            if (id != null) respondError(id, ErrorCodes.INVALID_REQUEST, "Missing method")
            return
        }
        val params = msg.get("params")?.takeIf { it.isJsonObject }?.asJsonObject ?: JsonObject()
        try {
            when (method) {
                "initialize" -> onWorker(id) { initialize(params) }
                "render" -> render(id, params)
                "cancel", "\$/cancelRequest" -> {
                    val requestId = params.str("requestId") ?: params.str("id")
                    val hit = requestId != null && queued.contains(requestId) && cancelled.add(requestId)
                    if (id != null) respond(id, JsonObject().apply { addProperty("cancelled", hit) })
                }
                "project/load" -> {
                    val spec = parseProjectSpec(params)
                    val projectId = params.str("projectId")?.takeIf { it.isNotEmpty() }
                    val classesChanged = params.get("classesChanged")?.takeIf { it.isJsonPrimitive }?.asBoolean ?: false
                    onWorker(id) { projectLoad(spec, projectId, classesChanged) }
                }
                "project/changed" -> {
                    val kind = params.str("kind") ?: throw RpcError(ErrorCodes.INVALID_PARAMS, "kind required ('res' | 'classes')")
                    if (kind != "res" && kind != "classes") throw RpcError(ErrorCodes.INVALID_PARAMS, "kind must be 'res' or 'classes'")
                    onWorker(id) { projectChanged(kind) }
                }
                "shutdown" -> onWorker(id) {
                    renderer.shutdown()
                    JsonNull.INSTANCE
                }.also { worker.execute { onExit() } }
                "exit" -> onExit()
                else -> if (id != null) respondError(id, ErrorCodes.METHOD_NOT_FOUND, "Unknown method: $method")
            }
        } catch (e: RpcError) {
            if (id != null) respondError(id, e.code, e.message ?: "")
        }
    }

    private fun initialize(params: JsonObject): JsonElement {
        val cacheDir = params.str("cacheDir")?.let(::File) ?: File(System.getProperty("java.io.tmpdir"), "ccm-layout-daemon")
        cacheDir.mkdirs()
        val info = renderer.initialize(cacheDir)
        return JsonObject().apply {
            addProperty("protocolVersion", PROTOCOL_VERSION)
            addProperty("layoutlibVersion", info.layoutlibVersion)
            addProperty("apiLevel", info.apiLevel)
            addProperty("initMs", info.initMs)
        }
    }

    private fun projectLoad(spec: ProjectSpec?, projectId: String?, classesChanged: Boolean): JsonElement {
        if (!renderer.initialized) throw RpcError(ErrorCodes.NOT_INITIALIZED, "initialize first")
        val info = renderer.loadProject(spec, projectId, classesChanged)
        return JsonObject().apply {
            addProperty("ok", true)
            addProperty("frameworkOnly", renderer.frameworkOnly)
            addProperty("resCount", info.resCount)
            addProperty("classpathCount", info.classpathCount)
            addProperty("rIds", info.rIds)
            addProperty("loadMs", info.loadMs)
            addProperty("reused", info.reused)
            addProperty("cached", info.cached)
            addProperty("restartSuggested", renderer.restartSuggested)
            add("warnings", JsonArray().also { a -> info.warnings.forEach(a::add) })
        }
    }

    private fun projectChanged(kind: String): JsonElement {
        if (!renderer.initialized) throw RpcError(ErrorCodes.NOT_INITIALIZED, "initialize first")
        val info = renderer.projectChanged(kind)
            ?: return JsonObject().apply {
                addProperty("ok", true)
                addProperty("frameworkOnly", true)
                addProperty("restartSuggested", false)
                add("warnings", JsonArray())
            }
        return JsonObject().apply {
            addProperty("ok", true)
            addProperty("frameworkOnly", false)
            addProperty("kind", info.kind)
            addProperty("reloadMs", info.ms)
            addProperty("restartSuggested", info.restartSuggested)
            add("warnings", JsonArray().also { a -> info.warnings.forEach(a::add) })
        }
    }

    /** null = no project (framework-only), e.g. `project/load {}`. */
    private fun parseProjectSpec(params: JsonObject): ProjectSpec? {
        val resDirs = params.paths("resDirs")
        val classpath = params.paths("classpath")
        val aars = params.get("aarResDirs")?.takeIf { it.isJsonArray }?.asJsonArray?.mapNotNull { e ->
            when {
                e.isJsonPrimitive -> File(e.asString).let { AarRes(it, it.parentFile?.name ?: it.name) }
                e.isJsonObject -> e.asJsonObject.str("dir")?.let { d ->
                    val dir = File(d)
                    AarRes(dir, e.asJsonObject.str("name") ?: dir.parentFile?.name ?: dir.name)
                }
                else -> null
            }
        }.orEmpty()
        if (resDirs.isEmpty() && classpath.isEmpty() && aars.isEmpty()) return null
        val packageName = params.str("packageName") ?: throw RpcError(ErrorCodes.INVALID_PARAMS, "packageName required")
        val themes = params.get("activityThemes")?.takeIf { it.isJsonObject }?.asJsonObject?.entrySet()
            ?.mapNotNull { (k, v) -> if (v.isJsonPrimitive) k to v.asString else null }?.toMap().orEmpty()
        return ProjectSpec(
            resDirs = resDirs,
            aarRes = aars,
            classpath = classpath,
            rJar = params.str("rJar")?.let(::File),
            packageName = packageName,
            namespace = params.str("namespace") ?: packageName,
            appTheme = params.str("appTheme"),
            activityThemes = themes,
            minSdk = params.int("minSdk"),
            targetSdk = params.int("targetSdk"),
        )
    }

    private fun render(id: JsonElement?, params: JsonObject) {
        val requestId = params.str("requestId") ?: id?.let { if (it.isJsonPrimitive) it.asString else null }
            ?: throw RpcError(ErrorCodes.INVALID_PARAMS, "requestId required")
        val xml = params.str("xmlContent") ?: throw RpcError(ErrorCodes.INVALID_PARAMS, "xmlContent required")
        val device = params.get("device")?.takeIf { it.isJsonObject }?.asJsonObject
        val req = RenderRequest(
            requestId = requestId,
            layoutPath = params.str("layoutPath"),
            xml = xml,
            device = Device(
                width = device?.int("width") ?: 1080,
                height = device?.int("height") ?: 2340,
                density = device?.int("density") ?: 440,
            ),
            theme = params.str("theme"),
            night = params.get("night")?.takeIf { it.isJsonPrimitive }?.asBoolean ?: false,
            locale = params.str("locale"),
            apiLevel = params.int("apiLevel"),
        )
        queued += requestId
        onWorker(id) {
            try {
                if (cancelled.remove(requestId)) throw RpcError(ErrorCodes.REQUEST_CANCELLED, "Request $requestId cancelled")
                if (!renderer.initialized) throw RpcError(ErrorCodes.NOT_INITIALIZED, "initialize first")
                toJson(requestId, renderer.render(req))
            } finally {
                queued.remove(requestId)
                cancelled.remove(requestId)
            }
        }
    }

    private fun onWorker(id: JsonElement?, block: () -> JsonElement) {
        worker.execute {
            try {
                val result = block()
                if (id != null) respond(id, result)
            } catch (e: RpcError) {
                if (id != null) respondError(id, e.code, e.message ?: "")
            } catch (t: Throwable) {
                if (id != null) respondError(id, ErrorCodes.INTERNAL_ERROR, t.describe())
            }
        }
    }

    private fun toJson(requestId: String, r: RenderOutcome): JsonObject = JsonObject().apply {
        addProperty("requestId", requestId)
        addProperty("png", r.png)
        addProperty("width", r.width)
        addProperty("height", r.height)
        add("viewTree", r.viewTree?.let(::nodeJson) ?: JsonNull.INSTANCE)
        add("diagnostics", JsonArray().also { arr ->
            r.diagnostics.forEach { d ->
                arr.add(JsonObject().apply {
                    addProperty("severity", d.severity)
                    addProperty("message", d.message)
                    if (d.line != null) addProperty("line", d.line)
                    if (d.column != null) addProperty("column", d.column)
                })
            }
        })
        addProperty("renderMs", r.renderMs)
        add("timings", JsonObject().also { t -> r.timings.forEach { (k, v) -> t.addProperty(k, v) } })
    }

    private fun nodeJson(n: ViewNode): JsonObject = JsonObject().apply {
        addProperty("class", n.cls)
        addProperty("xmlId", n.xmlId)
        addProperty("line", n.line)
        addProperty("column", n.column)
        add("bounds", JsonArray().also { a -> n.bounds.forEach(a::add) })
        add("children", JsonArray().also { a -> n.children.forEach { a.add(nodeJson(it)) } })
    }

    fun notify(method: String, params: JsonObject) {
        send(JsonObject().apply {
            addProperty("jsonrpc", "2.0")
            addProperty("method", method)
            add("params", params)
        })
    }

    private fun respond(id: JsonElement, result: JsonElement) {
        send(JsonObject().apply {
            addProperty("jsonrpc", "2.0")
            add("id", id)
            add("result", result)
        })
    }

    private fun respondError(id: JsonElement, code: Int, message: String) {
        send(JsonObject().apply {
            addProperty("jsonrpc", "2.0")
            add("id", id)
            add("error", JsonObject().apply {
                addProperty("code", code)
                addProperty("message", message)
            })
        })
    }

    fun encode(obj: JsonObject): String = gson.toJson(obj)
}

private fun JsonObject.str(key: String): String? = get(key)?.takeIf { it.isJsonPrimitive }?.asString

private fun JsonObject.paths(key: String): List<File> =
    get(key)?.takeIf { it.isJsonArray }?.asJsonArray?.mapNotNull { e -> e.takeIf { it.isJsonPrimitive }?.asString?.let(::File) }.orEmpty()

private fun JsonObject.int(key: String): Int? = get(key)?.takeIf { it.isJsonPrimitive && it.asJsonPrimitive.isNumber }?.asInt
