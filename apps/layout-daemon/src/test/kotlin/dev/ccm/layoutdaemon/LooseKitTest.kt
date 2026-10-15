package dev.ccm.layoutdaemon

import com.google.gson.JsonArray
import com.google.gson.JsonObject
import com.google.gson.JsonParser
import dev.ccm.layoutdaemon.RpcHarness.Companion.flatten
import dev.ccm.layoutdaemon.RpcHarness.Companion.messages
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

/** PLAN-v44: a loose layout XML (no Gradle project) renders library views through the bundled kit. */
@TestInstance(TestInstance.Lifecycle.PER_CLASS)
@TestMethodOrder(MethodOrderer.OrderAnnotation::class)
class LooseKitTest {
    private lateinit var rpc: RpcHarness
    private val kitDir = File(System.getProperty("loosekit.dir") ?: error("loosekit.dir not set"))

    @BeforeAll
    fun start() {
        rpc = RpcHarness()
    }

    @AfterAll
    fun stop() = rpc.close()

    /** Same mapping as the desktop's `looseKitPayload` (kit.json paths are relative to the kit dir). */
    private fun kitParams(): JsonObject {
        val kit = JsonParser.parseString(File(kitDir, "kit.json").readText()).asJsonObject
        val abs = { p: String -> File(kitDir, p).path }
        return JsonObject().apply {
            add("resDirs", JsonArray())
            add("aarResDirs", JsonArray().also { a ->
                kit.getAsJsonArray("aarRes").forEach { e ->
                    a.add(JsonObject().apply {
                        addProperty("dir", abs(e.asJsonObject.get("dir").asString))
                        addProperty("name", e.asJsonObject.get("name").asString)
                    })
                }
            })
            add("classpath", JsonArray().also { a -> kit.getAsJsonArray("classpath").forEach { a.add(abs(it.asString)) } })
            addProperty("rJar", abs(kit.get("rJar").asString))
            addProperty("packageName", kit.get("packageName").asString)
            addProperty("namespace", kit.get("packageName").asString)
            addProperty("appTheme", kit.get("appTheme").asString)
            add("activityThemes", JsonObject())
            addProperty("projectId", "loose-kit")
        }
    }

    private fun node(res: JsonObject, id: String) =
        flatten(res.getAsJsonObject("viewTree")).first { it.get("xmlId")?.takeUnless { e -> e.isJsonNull }?.asString == id }

    private fun bounds(n: JsonObject) = n.getAsJsonArray("bounds").map { it.asInt }

    private fun assertClean(msgs: List<String>) {
        assertFalse(msgs.any { "Class not found" in it || "NoClassDefFoundError" in it }, "$msgs")
        assertFalse(msgs.any { "Theme.AppCompat" in it || "Theme.MaterialComponents" in it || "requires your app theme" in it }, "$msgs")
        assertFalse(msgs.any { it.contains("failed to render", ignoreCase = true) }, "$msgs")
    }

    @Test
    @Order(1)
    fun `framework only shows ConstraintLayout as class not found`() {
        val msgs = messages(rpc.render(CONSTRAINT))
        assertTrue(msgs.any { "Class not found" in it && "ConstraintLayout" in it }, "$msgs")
    }

    @Test
    @Order(2)
    fun `kit renders a ConstraintLayout root with constrained children`() {
        val load = rpc.result("project/load", kitParams(), timeoutSec = 180)
        println("loose kit load=$load")
        assertTrue(load.get("ok").asBoolean, "$load")
        assertTrue(load.get("rIds").asInt > 1000, "$load")

        val res = rpc.render(CONSTRAINT)
        val msgs = messages(res)
        println("constraint diags=$msgs")
        assertClean(msgs)
        assertEquals("androidx.constraintlayout.widget.ConstraintLayout", res.getAsJsonObject("viewTree").get("class").asString)
        val corner = bounds(node(res, "@+id/corner"))
        assertEquals(1080, corner[2], "constrained to parent end: $corner")
        assertEquals(2340, corner[3], "constrained to parent bottom: $corner")
        val center = bounds(node(res, "@+id/center"))
        assertTrue(center[0] > 300 && center[1] > 1000, "centred: $center")
    }

    @Test
    @Order(3)
    fun `kit renders Material and AppCompat widgets with the default Material3 theme`() {
        val res = rpc.render(MATERIAL)
        val msgs = messages(res)
        println("material diags=$msgs")
        assertClean(msgs)
        mapOf(
            "@+id/toolbar" to "androidx.appcompat.widget.Toolbar",
            "@+id/card" to "com.google.android.material.card.MaterialCardView",
            "@+id/label" to "androidx.appcompat.widget.AppCompatTextView",
            "@+id/input" to "com.google.android.material.textfield.TextInputLayout",
            "@+id/button" to "com.google.android.material.button.MaterialButton",
        ).forEach { (id, cls) ->
            val n = node(res, id)
            assertEquals(cls, n.get("class").asString)
            val b = bounds(n)
            assertTrue(b[2] > b[0] && b[3] > b[1], "$id has a size: $b")
        }
        val toolbar = bounds(node(res, "@+id/toolbar"))
        val button = bounds(node(res, "@+id/button"))
        assertTrue(button[1] > toolbar[3], "button below the toolbar chain: $toolbar / $button")
        assertTrue(flatten(res.getAsJsonObject("viewTree")).any { it.get("class").asString == "com.google.android.material.textfield.TextInputEditText" })
    }

    @Test
    @Order(4)
    fun `tools theme wins over the kit default`() {
        val xml = MATERIAL.replace("<androidx.constraintlayout.widget.ConstraintLayout ", "<androidx.constraintlayout.widget.ConstraintLayout tools:theme=\"@style/Theme.MaterialComponents.Light.NoActionBar\" ")
        val msgs = messages(rpc.render(xml))
        assertClean(msgs)
        val night = messages(rpc.render(MATERIAL, night = true))
        assertClean(night)
    }

    @Test
    @Order(5)
    fun `kit renders checkable Material widgets with animated selectors`() {
        for (night in listOf(false, true)) {
            val res = rpc.render(CHECKABLE, night = night)
            val msgs = messages(res)
            println("checkable night=$night diags=$msgs")
            File(res.get("png").asString).copyTo(File("build/loose-kit-out/checkable-${if (night) "night" else "light"}.png"), overwrite = true)
            assertClean(msgs)
            assertFalse(msgs.any { "NullPointerException" in it || "Failed to" in it }, "$msgs")
            mapOf(
                "@+id/check" to "com.google.android.material.checkbox.MaterialCheckBox",
                "@+id/check_on" to "com.google.android.material.checkbox.MaterialCheckBox",
                "@+id/mcheck" to "com.google.android.material.checkbox.MaterialCheckBox",
                "@+id/mcheck_on" to "com.google.android.material.checkbox.MaterialCheckBox",
                "@+id/radio" to "com.google.android.material.radiobutton.MaterialRadioButton",
                "@+id/mswitch" to "com.google.android.material.materialswitch.MaterialSwitch",
                "@+id/sswitch" to "com.google.android.material.switchmaterial.SwitchMaterial",
                "@+id/chip" to "com.google.android.material.chip.Chip",
                "@+id/toggle" to "com.google.android.material.button.MaterialButtonToggleGroup",
                "@+id/slider" to "com.google.android.material.slider.Slider",
            ).forEach { (id, cls) ->
                val n = node(res, id)
                assertEquals(cls, n.get("class").asString, id)
                val b = bounds(n)
                assertTrue(b[2] > b[0] && b[3] > b[1], "$id has a size: $b")
            }
        }
    }

    private companion object {
        const val CHECKABLE = """<?xml version="1.0" encoding="utf-8"?>
<androidx.constraintlayout.widget.ConstraintLayout xmlns:android="http://schemas.android.com/apk/res/android"
    xmlns:app="http://schemas.android.com/apk/res-auto"
    android:layout_width="match_parent"
    android:layout_height="match_parent">
    <CheckBox android:id="@+id/check" android:layout_width="wrap_content" android:layout_height="wrap_content" android:text="Plain"
        app:layout_constraintTop_toTopOf="parent" app:layout_constraintStart_toStartOf="parent" />
    <CheckBox android:id="@+id/check_on" android:layout_width="wrap_content" android:layout_height="wrap_content" android:text="Plain on"
        android:checked="true" app:layout_constraintTop_toBottomOf="@id/check" app:layout_constraintStart_toStartOf="parent" />
    <com.google.android.material.checkbox.MaterialCheckBox android:id="@+id/mcheck" android:layout_width="wrap_content" android:layout_height="wrap_content"
        android:text="Material" app:layout_constraintTop_toBottomOf="@id/check_on" app:layout_constraintStart_toStartOf="parent" />
    <com.google.android.material.checkbox.MaterialCheckBox android:id="@+id/mcheck_on" android:layout_width="wrap_content" android:layout_height="wrap_content"
        android:text="Material on" android:checked="true" app:layout_constraintTop_toBottomOf="@id/mcheck" app:layout_constraintStart_toStartOf="parent" />
    <RadioButton android:id="@+id/radio" android:layout_width="wrap_content" android:layout_height="wrap_content" android:text="Radio"
        android:checked="true" app:layout_constraintTop_toBottomOf="@id/mcheck_on" app:layout_constraintStart_toStartOf="parent" />
    <com.google.android.material.materialswitch.MaterialSwitch android:id="@+id/mswitch" android:layout_width="wrap_content" android:layout_height="wrap_content"
        android:text="Switch" android:checked="true" app:layout_constraintTop_toBottomOf="@id/radio" app:layout_constraintStart_toStartOf="parent" />
    <com.google.android.material.switchmaterial.SwitchMaterial android:id="@+id/sswitch" android:layout_width="wrap_content" android:layout_height="wrap_content"
        android:text="Switch M2" app:layout_constraintTop_toBottomOf="@id/mswitch" app:layout_constraintStart_toStartOf="parent" />
    <com.google.android.material.chip.Chip android:id="@+id/chip" style="@style/Widget.Material3.Chip.Filter" android:layout_width="wrap_content"
        android:layout_height="wrap_content" android:text="Filter" android:checkable="true" android:checked="true"
        app:layout_constraintTop_toBottomOf="@id/sswitch" app:layout_constraintStart_toStartOf="parent" />
    <com.google.android.material.button.MaterialButtonToggleGroup android:id="@+id/toggle" android:layout_width="wrap_content"
        android:layout_height="wrap_content" app:singleSelection="true" app:checkedButton="@id/t1"
        app:layout_constraintTop_toBottomOf="@id/chip" app:layout_constraintStart_toStartOf="parent">
        <com.google.android.material.button.MaterialButton android:id="@+id/t1" style="?attr/materialButtonOutlinedStyle"
            android:layout_width="wrap_content" android:layout_height="wrap_content" android:text="One" />
        <com.google.android.material.button.MaterialButton android:id="@+id/t2" style="?attr/materialButtonOutlinedStyle"
            android:layout_width="wrap_content" android:layout_height="wrap_content" android:text="Two" />
    </com.google.android.material.button.MaterialButtonToggleGroup>
    <com.google.android.material.slider.Slider android:id="@+id/slider" android:layout_width="0dp" android:layout_height="wrap_content"
        android:valueFrom="0" android:valueTo="10" android:value="4"
        app:layout_constraintTop_toBottomOf="@id/toggle" app:layout_constraintStart_toStartOf="parent" app:layout_constraintEnd_toEndOf="parent" />
</androidx.constraintlayout.widget.ConstraintLayout>"""

        const val CONSTRAINT = """<?xml version="1.0" encoding="utf-8"?>
<androidx.constraintlayout.widget.ConstraintLayout xmlns:android="http://schemas.android.com/apk/res/android"
    xmlns:app="http://schemas.android.com/apk/res-auto"
    android:layout_width="match_parent"
    android:layout_height="match_parent">
    <TextView android:id="@+id/corner" android:layout_width="wrap_content" android:layout_height="wrap_content"
        android:text="Bottom end"
        app:layout_constraintBottom_toBottomOf="parent" app:layout_constraintEnd_toEndOf="parent" />
    <TextView android:id="@+id/center" android:layout_width="wrap_content" android:layout_height="wrap_content"
        android:text="Center"
        app:layout_constraintTop_toTopOf="parent" app:layout_constraintBottom_toBottomOf="parent"
        app:layout_constraintStart_toStartOf="parent" app:layout_constraintEnd_toEndOf="parent" />
</androidx.constraintlayout.widget.ConstraintLayout>"""

        const val MATERIAL = """<?xml version="1.0" encoding="utf-8"?>
<androidx.constraintlayout.widget.ConstraintLayout xmlns:android="http://schemas.android.com/apk/res/android"
    xmlns:app="http://schemas.android.com/apk/res-auto"
    xmlns:tools="http://schemas.android.com/tools"
    android:layout_width="match_parent"
    android:layout_height="match_parent">
    <androidx.appcompat.widget.Toolbar android:id="@+id/toolbar" android:layout_width="0dp" android:layout_height="?attr/actionBarSize"
        app:title="Loose kit"
        app:layout_constraintTop_toTopOf="parent" app:layout_constraintStart_toStartOf="parent" app:layout_constraintEnd_toEndOf="parent" />
    <com.google.android.material.card.MaterialCardView android:id="@+id/card" android:layout_width="0dp" android:layout_height="wrap_content"
        android:layout_margin="16dp"
        app:layout_constraintTop_toBottomOf="@id/toolbar" app:layout_constraintStart_toStartOf="parent" app:layout_constraintEnd_toEndOf="parent">
        <androidx.appcompat.widget.AppCompatTextView android:id="@+id/label" android:layout_width="wrap_content" android:layout_height="wrap_content"
            android:padding="16dp" android:text="Card body" />
    </com.google.android.material.card.MaterialCardView>
    <com.google.android.material.textfield.TextInputLayout android:id="@+id/input" android:layout_width="0dp" android:layout_height="wrap_content"
        android:layout_margin="16dp" android:hint="Email"
        app:layout_constraintTop_toBottomOf="@id/card" app:layout_constraintStart_toStartOf="parent" app:layout_constraintEnd_toEndOf="parent">
        <com.google.android.material.textfield.TextInputEditText android:layout_width="match_parent" android:layout_height="wrap_content" />
    </com.google.android.material.textfield.TextInputLayout>
    <com.google.android.material.button.MaterialButton android:id="@+id/button" android:layout_width="wrap_content" android:layout_height="wrap_content"
        android:text="Continue"
        app:layout_constraintTop_toBottomOf="@id/input" app:layout_constraintEnd_toEndOf="parent" />
</androidx.constraintlayout.widget.ConstraintLayout>"""
    }
}
