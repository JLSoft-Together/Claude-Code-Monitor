package dev.ccm.layoutdaemon

import java.awt.image.BufferedImage
import java.awt.image.DataBufferInt
import java.awt.image.SinglePixelPackedSampleModel
import java.io.ByteArrayOutputStream
import java.io.DataOutputStream
import java.io.File
import java.util.concurrent.Callable
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors
import java.util.zip.Adler32
import java.util.zip.CRC32
import java.util.zip.Deflater

/**
 * ImageIO's PNG encoder takes 200–290 ms for a 1080x2340 frame. Here: Up filter + deflate level 1, and the rows are
 * split into strips compressed in parallel (pigz style: raw deflate per strip, SYNC_FLUSH between strips, one zlib
 * header and a combined Adler-32), which keeps the encode short even before the JIT has warmed up.
 */
object PngWriter {
    private val SIGNATURE = byteArrayOf(0x89.toByte(), 'P'.code.toByte(), 'N'.code.toByte(), 'G'.code.toByte(), 13, 10, 26, 10)
    private const val MIN_STRIP_ROWS = 128
    private val threads = Runtime.getRuntime().availableProcessors().coerceIn(1, 4)
    private val pool: ExecutorService = Executors.newFixedThreadPool(threads) { r -> Thread(r, "png").apply { isDaemon = true } }

    fun write(image: BufferedImage, file: File) {
        val bytes = encode(image)
        file.outputStream().use { it.write(bytes) }
    }

    fun encode(image: BufferedImage): ByteArray {
        val w = image.width
        val h = image.height
        val argb = pixels(image)
        val opaque = argb.all { (it ushr 24) == 0xFF }
        val strips = (h / MIN_STRIP_ROWS).coerceIn(1, threads)
        val parts = if (strips == 1) {
            listOf(strip(argb, w, opaque, 0, h, true))
        } else {
            (0 until strips).map { i ->
                pool.submit(Callable { strip(argb, w, opaque, h * i / strips, h * (i + 1) / strips, i == strips - 1) })
            }.map { it.get() }
        }

        val idat = ByteArrayOutputStream(parts.sumOf { it.data.size } + 6)
        idat.write(0x78)
        idat.write(0x01)
        var adler = 1L
        for (p in parts) {
            idat.write(p.data)
            adler = combineAdler(adler, p.adler, p.length)
        }
        for (shift in intArrayOf(24, 16, 8, 0)) idat.write((adler ushr shift).toInt() and 0xFF)

        val out = ByteArrayOutputStream(idat.size() + 64)
        DataOutputStream(out).use { o ->
            o.write(SIGNATURE)
            val ihdr = ByteArrayOutputStream(13).also {
                DataOutputStream(it).apply {
                    writeInt(w)
                    writeInt(h)
                    writeByte(8)
                    writeByte(if (opaque) 2 else 6)
                    writeByte(0)
                    writeByte(0)
                    writeByte(0)
                }
            }
            chunk(o, "IHDR", ihdr.toByteArray(), ihdr.size())
            val data = idat.toByteArray()
            chunk(o, "IDAT", data, data.size)
            chunk(o, "IEND", ByteArray(0), 0)
        }
        return out.toByteArray()
    }

    /** JIT warm-up off the render thread so the first real encodes are not interpreted. */
    fun warmUpAsync(image: BufferedImage) {
        val copy = BufferedImage(image.width, image.height, BufferedImage.TYPE_INT_ARGB).also { it.graphics.drawImage(image, 0, 0, null) }
        // Inline strips, not the pool: a queued warm-up must never delay the first real encode.
        val argb = pixels(copy)
        Thread({ repeat(6) { runCatching { strip(argb, copy.width, true, 0, copy.height, true) } } }, "png-warmup").apply {
            isDaemon = true
            priority = Thread.MIN_PRIORITY
        }.start()
    }

    private class Strip(val data: ByteArray, val adler: Long, val length: Long)

    private fun strip(argb: IntArray, w: Int, opaque: Boolean, y0: Int, y1: Int, last: Boolean): Strip {
        val bpp = if (opaque) 3 else 4
        val rowLen = w * bpp
        var prev = ByteArray(rowLen)
        var cur = ByteArray(rowLen)
        if (y0 > 0) fillRow(argb, w, y0 - 1, opaque, prev)
        val filtered = ByteArray(rowLen + 1)
        filtered[0] = 2
        val deflater = Deflater(1, true)
        val adler = Adler32()
        val out = ByteArrayOutputStream(((y1 - y0) * rowLen / 16).coerceAtLeast(1024))
        val buf = ByteArray(1 shl 16)
        try {
            for (y in y0 until y1) {
                fillRow(argb, w, y, opaque, cur)
                for (k in 0 until rowLen) filtered[k + 1] = (cur[k] - prev[k]).toByte()
                adler.update(filtered)
                deflater.setInput(filtered)
                while (!deflater.needsInput()) {
                    val n = deflater.deflate(buf, 0, buf.size, Deflater.NO_FLUSH)
                    if (n > 0) out.write(buf, 0, n)
                }
                val t = prev
                prev = cur
                cur = t
            }
            if (last) {
                deflater.finish()
                while (!deflater.finished()) out.write(buf, 0, deflater.deflate(buf))
            } else {
                do {
                    val n = deflater.deflate(buf, 0, buf.size, Deflater.SYNC_FLUSH)
                    out.write(buf, 0, n)
                } while (n == buf.size)
            }
        } finally {
            deflater.end()
        }
        return Strip(out.toByteArray(), adler.value, (y1 - y0).toLong() * (rowLen + 1))
    }

    private fun fillRow(argb: IntArray, w: Int, y: Int, opaque: Boolean, row: ByteArray) {
        var o = 0
        val base = y * w
        for (x in 0 until w) {
            val p = argb[base + x]
            row[o++] = (p ushr 16).toByte()
            row[o++] = (p ushr 8).toByte()
            row[o++] = p.toByte()
            if (!opaque) row[o++] = (p ushr 24).toByte()
        }
    }

    /** zlib's adler32_combine: checksum of A+B from adler(A), adler(B) and len(B). */
    internal fun combineAdler(a1: Long, a2: Long, len2: Long): Long {
        val base = 65521L
        val rem = len2 % base
        var sum1 = a1 and 0xFFFF
        var sum2 = (rem * sum1) % base
        sum1 += (a2 and 0xFFFF) + base - 1
        sum2 += ((a1 ushr 16) and 0xFFFF) + ((a2 ushr 16) and 0xFFFF) + base - rem
        if (sum1 >= base) sum1 -= base
        if (sum1 >= base) sum1 -= base
        if (sum2 >= base shl 1) sum2 -= base shl 1
        if (sum2 >= base) sum2 -= base
        return sum1 or (sum2 shl 16)
    }

    private fun pixels(image: BufferedImage): IntArray {
        val w = image.width
        val h = image.height
        val raster = image.raster
        val buffer = raster.dataBuffer
        val model = raster.sampleModel
        val packed = buffer is DataBufferInt && model is SinglePixelPackedSampleModel && model.scanlineStride == w &&
            raster.sampleModelTranslateX == 0 && raster.sampleModelTranslateY == 0 && buffer.numBanks == 1 && buffer.offset == 0
        if (packed && image.type == BufferedImage.TYPE_INT_ARGB) return (buffer as DataBufferInt).data
        // layoutlib frames are ARGB_PRE; getRGB() un-premultiplies through the colour model per pixel (~20 ms a frame).
        if (packed && image.type == BufferedImage.TYPE_INT_ARGB_PRE) return unpremultiply((buffer as DataBufferInt).data)
        return image.getRGB(0, 0, w, h, null, 0, w)
    }

    private fun unpremultiply(src: IntArray): IntArray {
        if (src.all { (it ushr 24) == 0xFF }) return src
        return IntArray(src.size) { i ->
            val p = src[i]
            when (val a = p ushr 24) {
                0xFF -> p
                0 -> 0
                else -> {
                    val r = minOf(255, ((p ushr 16) and 0xFF) * 255 / a)
                    val g = minOf(255, ((p ushr 8) and 0xFF) * 255 / a)
                    val b = minOf(255, (p and 0xFF) * 255 / a)
                    (a shl 24) or (r shl 16) or (g shl 8) or b
                }
            }
        }
    }

    private fun chunk(out: DataOutputStream, type: String, data: ByteArray, len: Int) {
        val typeBytes = type.toByteArray(Charsets.US_ASCII)
        out.writeInt(len)
        out.write(typeBytes)
        out.write(data, 0, len)
        val crc = CRC32()
        crc.update(typeBytes)
        crc.update(data, 0, len)
        out.writeInt(crc.value.toInt())
    }
}
