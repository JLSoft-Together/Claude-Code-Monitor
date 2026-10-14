package dev.ccm.layoutdaemon

import com.google.gson.JsonArray
import com.google.gson.JsonObject
import com.google.gson.JsonParser
import dev.ccm.layoutdaemon.RpcHarness.Companion.flatten
import dev.ccm.layoutdaemon.RpcHarness.Companion.messages
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable
import java.io.File

/**
 * Manual check against a real, already built Android app (skipped by default):
 * CCM_PROJECT_MODEL=<json from init/ccm-project-model.gradle> CCM_PROJECT_LAYOUTS=<layout.xml>[,<layout.xml>…] ./gradlew test --tests '*RealProjectTest*'
 * PNGs land in build/real-project/.
 */
@EnabledIfEnvironmentVariable(named = "CCM_PROJECT_MODEL", matches = ".+")
class RealProjectTest {
    @Test
    fun `renders layouts of a built project`() {
        val model = JsonParser.parseString(File(System.getenv("CCM_PROJECT_MODEL")).readText()).asJsonObject
        val layouts = System.getenv("CCM_PROJECT_LAYOUTS").orEmpty().split(',').filter { it.isNotBlank() }.map(::File)
        val out = File("build/real-project").apply { mkdirs() }
        val rpc = RpcHarness()
        try {
            val load = rpc.result("project/load", toLoadParams(model), timeoutSec = 300)
            println("project/load=$load")
            assertFalse(load.get("frameworkOnly").asBoolean)
            for (layout in layouts) {
                val xml = layout.readText()
                rpc.render(xml)
                val res = rpc.render(xml)
                val png = res.get("png").takeUnless { it.isJsonNull }?.asString
                val classes = res.get("viewTree").takeUnless { it.isJsonNull }?.let { flatten(it.asJsonObject).map { n -> n.get("class").asString } }
                println("${layout.name}: renderMs=${res.get("renderMs")} timings=${res.get("timings")}\n  classes=${classes?.distinct()}\n  diags=${messages(res)}")
                assertTrue(png != null, "png for ${layout.name}")
                File(png!!).copyTo(File(out, layout.nameWithoutExtension + ".png"), overwrite = true)
            }
        } finally {
            rpc.close()
        }
    }

    /** Same mapping as apps/desktop/src/layout/projectModel.ts (minus its existence filter / caps). */
    private fun toLoadParams(m: JsonObject) = JsonObject().apply {
        fun list(key: String) = m.getAsJsonArray(key)?.map { it.asString }.orEmpty()
        add("resDirs", RpcHarness.strings(list("resDirs") + list("generatedResDirs")))
        add("aarResDirs", JsonArray().also { a ->
            m.getAsJsonArray("aarRes")?.forEach { e ->
                val o = e.asJsonObject
                a.add(JsonObject().apply {
                    addProperty("dir", o.get("dir").asString)
                    addProperty("name", o.get("name")?.asString ?: "")
                })
            }
        })
        add("classpath", RpcHarness.strings(list("classDirs") + list("classpath")))
        m.get("rJar")?.takeUnless { it.isJsonNull }?.let { addProperty("rJar", it.asString) }
        addProperty("packageName", (m.get("applicationId") ?: m.get("namespace")).asString)
        addProperty("namespace", m.get("namespace").asString)
        m.get("appTheme")?.takeUnless { it.isJsonNull }?.let { addProperty("appTheme", it.asString) }
        add("activityThemes", m.getAsJsonObject("activityThemes") ?: JsonObject())
        m.get("minSdk")?.takeUnless { it.isJsonNull }?.let { addProperty("minSdk", it.asInt) }
        m.get("targetSdk")?.takeUnless { it.isJsonNull }?.let { addProperty("targetSdk", it.asInt) }
    }
}
