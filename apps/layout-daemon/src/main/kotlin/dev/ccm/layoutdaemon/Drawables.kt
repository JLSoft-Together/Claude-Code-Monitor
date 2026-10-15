package dev.ccm.layoutdaemon

import android.content.Context
import android.content.res.ColorStateList
import android.graphics.Canvas
import android.graphics.drawable.Drawable
import android.view.View

data class DrawableRequest(
    val requestId: String,
    val path: String?,
    val xml: String,
    val device: Device,
    val night: Boolean,
    /** UI state chips: pressed, focused, selected, checked, activated, disabled. */
    val states: List<String>,
    /** `res/color*` selector: per-state colours instead of an image. */
    val colorList: Boolean,
)

class Swatch(val state: String, val color: String)

class DrawableOutcome(
    val png: String?,
    val width: Int,
    val height: Int,
    val swatches: List<Swatch>?,
    val diagnostics: List<Diagnostic>,
    val renderMs: Long,
)

/**
 * Draws one drawable over its whole size; the view never pushes its own state onto it (the chips decide).
 * The session paints the theme's windowBackground on a parent; it is cleared while attached so the PNG keeps
 * the drawable's own transparency, and [restore]d afterwards because the session is reused for layouts.
 */
class DrawableView(context: Context, private val drawable: Drawable) : View(context) {
    private val cleared = ArrayList<Pair<View, Drawable?>>()

    override fun onAttachedToWindow() {
        super.onAttachedToWindow()
        var p = parent
        while (p is View) {
            if (p.background != null) {
                cleared += p to p.background
                p.background = null
            }
            p = p.parent
        }
    }

    fun restore() {
        for ((v, bg) in cleared) v.background = bg
        cleared.clear()
    }

    override fun onDraw(canvas: Canvas) {
        drawable.setBounds(0, 0, width, height)
        drawable.draw(canvas)
    }
}

object Drawables {
    private val ATTRS = mapOf(
        "pressed" to android.R.attr.state_pressed,
        "focused" to android.R.attr.state_focused,
        "selected" to android.R.attr.state_selected,
        "checked" to android.R.attr.state_checked,
        "activated" to android.R.attr.state_activated,
    )

    val SWATCH_STATES = listOf("default", "pressed", "focused", "selected", "checked", "activated", "disabled")

    /** Like a real view: enabled + window focused unless `disabled`; unknown names are ignored. */
    fun stateSet(states: Collection<String>): IntArray {
        val out = ArrayList<Int>()
        if ("disabled" !in states) out += android.R.attr.state_enabled
        out += android.R.attr.state_window_focused
        for (s in states) ATTRS[s]?.let { out += it }
        return out.toIntArray()
    }

    fun swatches(list: ColorStateList): List<Swatch> = SWATCH_STATES.map { s ->
        val set = stateSet(if (s == "default") emptyList() else listOf(s))
        Swatch(s, "#%08X".format(list.getColorForState(set, list.defaultColor)))
    }
}
