package dev.ccm.layoutdaemon

import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import java.io.File
import java.nio.file.Files
import javax.imageio.ImageIO

class SampleDataTest {
    @Test
    fun `references without an index take the next item, explicit ones stay`() {
        val r = SampleData.Resolver(mapOf("names.txt" to listOf("Ann", "Bob")))
        val names = SampleData.TEXT.getValue("full_names")
        assertEquals(names[0], r.resolve("@tools:sample/full_names"))
        assertEquals(names[1], r.resolve("@tools:sample/full_names"))
        assertEquals(names[4], r.resolve("@tools:sample/full_names[4]"))
        assertEquals(names[2], r.resolve("@tools:sample/full_names"))
        assertEquals("@drawable/ccm_sample_scenic_0", r.resolve("@tools:sample/backgrounds/scenic"))
        assertEquals("@drawable/ccm_sample_avatar_3", r.resolve("@tools:sample/avatars[13]"))
        assertEquals("Ann", r.resolve("@sample/names.txt"))
        assertEquals("Bob", r.resolve("@sample/names.txt"))
        assertEquals("Ann", r.resolve("@sample/names.txt"))
        assertNull(r.resolve("@tools:sample/unknown"))
        assertNull(r.resolve("@sample/missing"))
        assertNull(r.resolve("@string/app_name"))
    }

    @Test
    fun `images are drawn once and project sampledata is read`() {
        val dir = Files.createTempDirectory("ccm-sample").toFile()
        try {
            SampleData.init(dir)
            val res = SampleData.resDir!!
            val pngs = File(res, "drawable-nodpi").listFiles()!!.map { it.name }.sorted()
            assertEquals(SampleData.COUNT * 2, pngs.size)
            val img = ImageIO.read(File(res, "drawable-nodpi/ccm_sample_scenic_0.png"))
            assertEquals(640, img.width)
            assertTrue(img.getRGB(10, 10) != img.getRGB(10, 390), "sky differs from the ground")
            val stamp = File(res, "drawable-nodpi/ccm_sample_avatar_0.png").lastModified()
            SampleData.ensureImages(res)
            assertEquals(stamp, File(res, "drawable-nodpi/ccm_sample_avatar_0.png").lastModified())

            val sd = File(dir, "module/sampledata").apply { mkdirs() }
            File(sd, "products").writeText("Tea\n\nCoffee\n")
            File(sd, "data.json").writeText("{}")
            File(sd, "photos").mkdirs()
            ImageIO.write(img, "png", File(sd, "photos/b.png"))
            ImageIO.write(img, "png", File(sd, "photos/a.png"))
            val (items, sampleRes) = SampleData.loadProject(listOf(sd))
            assertEquals(listOf("Tea", "Coffee"), items["products"])
            assertEquals(listOf("@drawable/ccm_sd_photos_0", "@drawable/ccm_sd_photos_1"), items["photos"])
            assertTrue("data.json" !in items)
            assertTrue(File(sampleRes, "drawable-nodpi/ccm_sd_photos_1.png").isFile)
        } finally {
            dir.deleteRecursively()
        }
    }
}
