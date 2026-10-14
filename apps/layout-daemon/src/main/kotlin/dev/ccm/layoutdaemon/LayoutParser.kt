package dev.ccm.layoutdaemon

import com.android.ide.common.rendering.api.ILayoutPullParser
import com.android.ide.common.rendering.api.ResourceNamespace
import org.kxml2.io.KXmlParser
import org.xmlpull.v1.XmlPullParser
import java.io.StringReader

/** View cookie: where the start tag's `<` sits (1-based) plus its `android:id` as written. */
data class TagInfo(val name: String, val line: Int, val column: Int, val xmlId: String?)

data class TagStart(val name: String, val line: Int, val column: Int)

/**
 * KXml's lineNumber at START_TAG is the line of the closing `>`, so tag starts are pre-scanned
 * from the source text and matched to START_TAG events by document order.
 * `tools:X` design-time attributes (text, visibility, src…) shadow `android:X` like in Android Studio.
 */
class LayoutParser(xml: String) : KXmlParser(), ILayoutPullParser {
    val starts: List<TagStart> = scanStartTags(xml)
    private var startIndex = -1
    var current: TagInfo? = null
        private set
    private var overlay: List<Attr>? = null

    init {
        setFeature(XmlPullParser.FEATURE_PROCESS_NAMESPACES, true)
        setInput(StringReader(xml))
    }

    override fun next(): Int = super.next().also(::track)

    override fun nextToken(): Int = super.nextToken().also(::track)

    private fun track(event: Int) {
        overlay = null
        if (event != XmlPullParser.START_TAG) return
        overlay = toolsOverlay()
        startIndex++
        val start = starts.getOrNull(startIndex)
        current = TagInfo(
            name = name,
            line = start?.line ?: lineNumber,
            column = start?.column ?: columnNumber,
            xmlId = getAttributeValue(ANDROID_NS, "id"),
        )
    }

    private fun toolsOverlay(): List<Attr>? {
        val n = super.getAttributeCount()
        var shadows = false
        for (i in 0 until n) {
            if (super.getAttributeNamespace(i) == TOOLS_NS && super.getAttributeName(i) !in TOOLS_ONLY) shadows = true
        }
        if (!shadows) return null
        val attrs = ArrayList<Attr>(n + 2)
        for (i in 0 until n) {
            attrs += Attr(super.getAttributeNamespace(i), super.getAttributeName(i), super.getAttributePrefix(i), super.getAttributeValue(i))
        }
        for (tool in attrs.filter { it.ns == TOOLS_NS && it.name !in TOOLS_ONLY }) {
            attrs.removeAll { it.ns == ANDROID_NS && it.name == tool.name }
            attrs += Attr(ANDROID_NS, tool.name, "android", tool.value)
        }
        return attrs
    }

    override fun getAttributeCount(): Int = overlay?.size ?: super.getAttributeCount()

    override fun getAttributeNamespace(index: Int): String = overlay?.get(index)?.ns ?: super.getAttributeNamespace(index)

    override fun getAttributeName(index: Int): String = overlay?.get(index)?.name ?: super.getAttributeName(index)

    override fun getAttributePrefix(index: Int): String? = overlay?.let { it[index].prefix } ?: super.getAttributePrefix(index)

    override fun getAttributeValue(index: Int): String = overlay?.get(index)?.value ?: super.getAttributeValue(index)

    override fun getAttributeValue(namespace: String?, name: String): String? {
        val o = overlay ?: return super.getAttributeValue(namespace, name)
        return o.firstOrNull { (namespace == null || it.ns == namespace) && it.name == name }?.value
    }

    override fun getViewCookie(): Any? = if (eventType == XmlPullParser.START_TAG) current else null

    override fun getLayoutNamespace(): ResourceNamespace = ResourceNamespace.RES_AUTO

    private class Attr(val ns: String, val name: String, val prefix: String?, val value: String)

    companion object {
        const val ANDROID_NS = "http://schemas.android.com/apk/res/android"
        const val TOOLS_NS = "http://schemas.android.com/tools"

        // Design-time attributes with their own meaning; every other tools:X shadows android:X.
        private val TOOLS_ONLY = setOf(
            "context", "layout", "listitem", "listheader", "listfooter", "itemCount", "ignore", "targetApi",
            "locale", "showIn", "menu", "actionBarNavMode", "openDrawer", "viewBindingIgnore", "viewBindingType",
            "parentTag", "keep", "discard", "shrinkMode", "sample", "minValue", "maxValue", "theme",
            "layout_editor_absoluteX", "layout_editor_absoluteY", "composableName", "node", "replace", "remove",
        )

        /** Root tag's `tools:context` (activity whose theme the preview uses), null when absent or unparsable. */
        fun toolsContext(xml: String): String? = try {
            val p = KXmlParser()
            p.setFeature(XmlPullParser.FEATURE_PROCESS_NAMESPACES, true)
            p.setInput(StringReader(xml))
            var e = p.next()
            while (e != XmlPullParser.START_TAG && e != XmlPullParser.END_DOCUMENT) e = p.next()
            if (e == XmlPullParser.START_TAG) p.getAttributeValue(TOOLS_NS, "context") else null
        } catch (_: Exception) {
            null
        }
    }
}

fun scanStartTags(xml: String): List<TagStart> {
    val out = ArrayList<TagStart>()
    var i = 0
    var line = 1
    var lineStart = 0
    val n = xml.length

    fun advanceTo(end: Int) {
        val stop = minOf(end, n)
        while (i < stop) {
            val c = xml[i]
            if (c == '\n' || (c == '\r' && (i + 1 >= n || xml[i + 1] != '\n'))) {
                line++
                lineStart = i + 1
            }
            i++
        }
    }

    fun skipPast(token: String) {
        val j = xml.indexOf(token, i)
        advanceTo(if (j < 0) n else j + token.length)
    }

    while (i < n) {
        if (xml[i] != '<') {
            advanceTo(i + 1)
            continue
        }
        when {
            xml.startsWith("<!--", i) -> skipPast("-->")
            xml.startsWith("<![CDATA[", i) -> skipPast("]]>")
            xml.startsWith("<?", i) -> skipPast("?>")
            xml.startsWith("<!", i) || xml.startsWith("</", i) -> skipPast(">")
            else -> {
                var j = i + 1
                while (j < n && !xml[j].isWhitespace() && xml[j] != '>' && xml[j] != '/') j++
                out += TagStart(xml.substring(i + 1, j), line, i - lineStart + 1)
                var quote: Char? = null
                while (j < n) {
                    val c = xml[j]
                    if (quote != null) {
                        if (c == quote) quote = null
                    } else if (c == '"' || c == '\'') {
                        quote = c
                    } else if (c == '>') {
                        break
                    }
                    j++
                }
                advanceTo(j + 1)
            }
        }
    }
    return out
}
