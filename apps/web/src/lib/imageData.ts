/** Clipboard / dropped images → PNG data URL (what `ccm:clipboard-image` accepts) + a small preview. Memory only. */

export async function clipboardImageBlob(): Promise<Blob | null> {
  try {
    for (const item of await navigator.clipboard.read()) {
      const type = item.types.find((t) => t.startsWith('image/'))
      if (type) return await item.getType(type)
    }
  } catch {
    // permission denied / no image / unsupported formats
  }
  return null
}

function readDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(blob)
  })
}

export async function imageData(blob: Blob, thumbPx = 96): Promise<{ data: string; thumb: string } | null> {
  let bmp: ImageBitmap | null = null
  try {
    bmp = await createImageBitmap(blob)
    const image = bmp
    const draw = (w: number, h: number): string => {
      const canvas = document.createElement('canvas')
      canvas.width = w
      canvas.height = h
      canvas.getContext('2d')!.drawImage(image, 0, 0, w, h)
      return canvas.toDataURL('image/png')
    }
    const data = blob.type === 'image/png' ? await readDataUrl(blob) : draw(image.width, image.height)
    const scale = Math.min(1, thumbPx / Math.max(image.width, image.height))
    const thumb = draw(Math.max(1, Math.round(image.width * scale)), Math.max(1, Math.round(image.height * scale)))
    return { data, thumb }
  } catch {
    return null
  } finally {
    bmp?.close()
  }
}
