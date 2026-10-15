package dev.ccm.layoutdaemon

import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Test
import java.awt.image.BufferedImage
import java.util.Random
import java.util.zip.Adler32
import javax.imageio.ImageIO

class PngWriterTest {
    private fun roundTrip(image: BufferedImage): BufferedImage = ImageIO.read(PngWriter.encode(image).inputStream())

    @Test
    fun `parallel strips decode to the same pixels`() {
        val rnd = Random(7)
        val img = BufferedImage(300, 1000, BufferedImage.TYPE_INT_ARGB)
        for (y in 0 until img.height) for (x in 0 until img.width) {
            img.setRGB(x, y, if (y % 50 < 25) 0xFF000000.toInt() or (x * 3 shl 8) or y % 256 else (0xFF shl 24) or rnd.nextInt(0xFFFFFF))
        }
        val back = roundTrip(img)
        for (y in 0 until img.height step 7) for (x in 0 until img.width step 3) assertEquals(img.getRGB(x, y), back.getRGB(x, y), "pixel $x,$y")
    }

    @Test
    fun `premultiplied translucent frames keep their colours`() {
        val img = BufferedImage(64, 600, BufferedImage.TYPE_INT_ARGB_PRE)
        val g = img.createGraphics()
        g.color = java.awt.Color(200, 100, 50, 128)
        g.fillRect(0, 0, 64, 300)
        g.dispose()
        val back = roundTrip(img)
        val p = back.getRGB(10, 10)
        assertEquals(128, p ushr 24)
        assertEquals(200.0, ((p ushr 16) and 0xFF).toDouble(), 2.0)
        assertEquals(50.0, (p and 0xFF).toDouble(), 2.0)
        assertEquals(0, back.getRGB(10, 400) ushr 24)
    }

    @Test
    fun `adler combine matches a single pass`() {
        val a = ByteArray(70_000) { (it * 31).toByte() }
        val b = ByteArray(130_001) { (it * 7 + 3).toByte() }
        val whole = Adler32().apply { update(a); update(b) }.value
        val pa = Adler32().apply { update(a) }.value
        val pb = Adler32().apply { update(b) }.value
        assertEquals(whole, PngWriter.combineAdler(pa, pb, b.size.toLong()))
    }
}
