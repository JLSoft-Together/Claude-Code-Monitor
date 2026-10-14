package dev.ccm.layoutdaemon

import java.awt.image.BufferedImage
import java.awt.image.DataBufferInt
import java.awt.image.SinglePixelPackedSampleModel
import java.io.ByteArrayOutputStream
import java.io.DataOutputStream
import java.io.File
import java.util.zip.CRC32
import java.util.zip.Deflater
import java.util.zip.DeflaterOutputStream

/**
 * ImageIO's PNG encoder takes 200–290 ms for a 1080x2340 frame; deflate level 1 with the Up filter
 * (UI frames repeat rows a lot) is several times faster and the file is only read once, locally.
 */
object PngWriter {
    private val SIGNATURE = byteArrayOf(0x89.toByte(), 'P'.code.toByte(), 'N'.code.toByte(), 'G'.code.toByte(), 13, 10, 26, 10)

    fun write(image: BufferedImage, file: File) {
        val w = image.width
        val h = image.height
        val argb = pixels(image)
        val opaque = argb.all { (it ushr 24) == 0xFF }
        val bpp = if (opaque) 3 else 4
        val rowLen = w * bpp

        val compressed = ByteArrayOutputStream(w * h / 4)
        val deflater = Deflater(1)
        DeflaterOutputStream(compressed, deflater, 1 shl 16).use { z ->
            var prev = ByteArray(rowLen)
            var cur = ByteArray(rowLen)
            val filtered = ByteArray(rowLen + 1)
            filtered[0] = 2
            for (y in 0 until h) {
                var o = 0
                val base = y * w
                for (x in 0 until w) {
                    val p = argb[base + x]
                    cur[o++] = (p ushr 16).toByte()
                    cur[o++] = (p ushr 8).toByte()
                    cur[o++] = p.toByte()
                    if (!opaque) cur[o++] = (p ushr 24).toByte()
                }
                for (k in 0 until rowLen) filtered[k + 1] = (cur[k] - prev[k]).toByte()
                z.write(filtered)
                val t = prev
                prev = cur
                cur = t
            }
        }
        deflater.end()

        DataOutputStream(file.outputStream().buffered(1 shl 16)).use { out ->
            out.write(SIGNATURE)
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
            chunk(out, "IHDR", ihdr.toByteArray(), ihdr.size())
            val idat = compressed.toByteArray()
            chunk(out, "IDAT", idat, idat.size)
            chunk(out, "IEND", ByteArray(0), 0)
        }
    }

    private fun pixels(image: BufferedImage): IntArray {
        val w = image.width
        val h = image.height
        val raster = image.raster
        val buffer = raster.dataBuffer
        val model = raster.sampleModel
        if (image.type == BufferedImage.TYPE_INT_ARGB && buffer is DataBufferInt &&
            model is SinglePixelPackedSampleModel && model.scanlineStride == w &&
            raster.sampleModelTranslateX == 0 && raster.sampleModelTranslateY == 0 &&
            buffer.numBanks == 1 && buffer.offset == 0
        ) {
            return buffer.data
        }
        return image.getRGB(0, 0, w, h, null, 0, w)
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
