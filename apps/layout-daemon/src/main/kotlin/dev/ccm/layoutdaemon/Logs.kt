package dev.ccm.layoutdaemon

import com.android.ide.common.rendering.api.ILayoutLog
import java.io.ByteArrayOutputStream
import java.io.OutputStream
import java.util.logging.Handler
import java.util.logging.Level
import java.util.logging.LogManager
import java.util.logging.LogRecord

data class Diagnostic(val severity: String, val message: String, val line: Int? = null, val column: Int? = null)

typealias LogSink = (level: String, message: String) -> Unit

object Noise {
    private val patterns = listOf(
        Regex("ImageReader_JNI"),
        Regex("maxImages"),
        Regex("Aconfig", RegexOption.IGNORE_CASE),
        Regex("mmap"),
        Regex("DelegateManager"),
        Regex("Conflicting definitions of"),
        Regex("^(SystemFonts|HWUI|InputEventCompatHandler) \\["),
        Regex("^\\s*$"),
    )

    fun isNoise(message: String): Boolean = patterns.any { it.containsMatchIn(message) }
}

fun Throwable.describe(): String {
    var root: Throwable = this
    val seen = HashSet<Throwable>()
    while (root.cause != null && root.cause !== root && seen.add(root)) root = root.cause!!
    val head = "${javaClass.simpleName}: ${message ?: ""}".trim()
    return if (root === this) head else "$head (cause: ${root.javaClass.simpleName}: ${root.message ?: ""})"
}

/**
 * Paparazzi and layoutlib log through java.util.logging; during a render the records become
 * diagnostics, otherwise filtered `log` notifications. Nothing may reach stdout (protocol channel).
 */
object LogCapture : Handler() {
    @Volatile var sink: LogSink = { _, _ -> }
    @Volatile private var collecting: MutableList<Diagnostic>? = null

    fun install() {
        val root = LogManager.getLogManager().getLogger("")
        root.handlers.forEach(root::removeHandler)
        root.addHandler(this)
        root.level = Level.INFO
    }

    fun <T> collect(into: MutableList<Diagnostic>, block: () -> T): T {
        collecting = into
        try {
            return block()
        } finally {
            collecting = null
        }
    }

    override fun publish(record: LogRecord) {
        val text = buildString {
            append(formatMessage(record))
            record.thrown?.let { append(" — ").append(it.describe()) }
        }
        if (Noise.isNoise(text)) return
        val target = collecting
        val level = record.level.intValue()
        if (target != null && level >= Level.WARNING.intValue()) {
            add(target, Diagnostic(if (level >= Level.SEVERE.intValue()) "error" else "warning", text))
        } else {
            sink(levelName(record.level), text)
        }
    }

    private fun formatMessage(record: LogRecord): String {
        val msg = record.message ?: return ""
        val params = record.parameters
        if (params.isNullOrEmpty()) return msg
        return try {
            val flat = params.flatMap { if (it is Array<*>) it.toList() else listOf(it) }.toTypedArray()
            if (msg.contains("{0")) java.text.MessageFormat.format(msg, *flat) else msg.format(*flat)
        } catch (_: Exception) {
            msg
        }
    }

    override fun flush() = Unit
    override fun close() = Unit

    private fun levelName(level: Level) = when {
        level.intValue() >= Level.SEVERE.intValue() -> "error"
        level.intValue() >= Level.WARNING.intValue() -> "warning"
        level.intValue() >= Level.INFO.intValue() -> "info"
        else -> "debug"
    }

    fun add(target: MutableList<Diagnostic>, d: Diagnostic) {
        synchronized(target) {
            if (target.none { it.message == d.message && it.line == d.line }) target += d
        }
    }
}

/** Swapped in as layoutlib's Bridge log while inflating, so errors keep their view cookie (XML position). */
class CookieLog(private val into: MutableList<Diagnostic>, private val fallbackTag: () -> TagInfo?) : ILayoutLog {
    private fun add(severity: String, tag: String?, message: String?, throwable: Throwable?, cookie: Any?) {
        val text = buildString {
            append(message ?: throwable?.message ?: tag ?: "unknown")
            if (throwable != null && message != null) append(" — ").append(throwable.describe())
        }
        if (Noise.isNoise(text)) return
        val pos = (cookie as? TagInfo) ?: fallbackTag()
        LogCapture.add(into, Diagnostic(severity, text, pos?.line, pos?.column))
    }

    override fun warning(tag: String?, message: String?, viewCookie: Any?, data: Any?) =
        add("warning", tag, message, null, viewCookie)

    override fun fidelityWarning(tag: String?, message: String?, throwable: Throwable?, viewCookie: Any?, data: Any?) =
        add("warning", tag, message, throwable, viewCookie)

    override fun error(tag: String?, message: String?, viewCookie: Any?, data: Any?) =
        add("error", tag, message, null, viewCookie)

    override fun error(tag: String?, message: String?, throwable: Throwable?, viewCookie: Any?, data: Any?) =
        add("error", tag, message, throwable, viewCookie)

    override fun logAndroidFramework(priority: Int, tag: String?, message: String?) {
        val text = "$tag: $message"
        if (!Noise.isNoise(text)) LogCapture.sink(if (priority >= 6) "error" else if (priority == 5) "warning" else "info", text)
    }
}

/** Replaces System.out so stray prints from layoutlib become `log` notifications instead of corrupting framing. */
class LineLogStream(private val level: String) : OutputStream() {
    private val buf = ByteArrayOutputStream()

    @Synchronized override fun write(b: Int) {
        if (b == '\n'.code) flushLine() else buf.write(b)
    }

    @Synchronized override fun write(b: ByteArray, off: Int, len: Int) {
        for (k in off until off + len) write(b[k].toInt())
    }

    private fun flushLine() {
        val line = buf.toString(Charsets.UTF_8).trimEnd('\r')
        buf.reset()
        if (!Noise.isNoise(line)) LogCapture.sink(level, line)
    }
}
