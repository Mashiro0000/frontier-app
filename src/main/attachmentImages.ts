import { nativeImage, type NativeImage } from 'electron'
import { orientBitmap } from './attachmentFormats'
import type { ImageTools } from './attachmentStore'

// Electron's own image tools for attachments (Stage 9.1, D-037): decoding a PNG or JPEG, making it smaller, turning it upright, and the small picture
// on the chip. `nativeImage` is Chromium's decoder and encoder: no package (D-037). It decodes PNG and JPEG only (GIF and WebP are kept as they come,
// and never given to it), does NOT apply a photo's EXIF orientation (checked on Electron 44: a JPEG marked "turn 90 degrees" decodes as stored), and
// writes no metadata when it encodes. The size of what it is given was read from the file's header and capped first (attachmentStore.ts).

const decode = (bytes: Buffer): NativeImage | null => {
  const image = nativeImage.createFromBuffer(bytes)
  return image.isEmpty() ? null : image
}

/** True if every pixel is fully opaque (4 bytes a pixel; the alpha is the fourth in both of Chromium's orders). */
function opaque(bitmap: Buffer): boolean {
  for (let i = 3; i < bitmap.length; i += 4) if (bitmap[i] !== 255) return false
  return true
}

export const electronImageTools: ImageTools = {
  decodedSize(bytes) {
    const image = decode(bytes)
    return image === null ? null : image.getSize()
  },

  reencode(bytes, type, { maxEdge, orientation, maxBytes }) {
    const image = decode(bytes)
    if (image === null) return null
    const { width, height } = image.getSize()
    let scale = Math.min(1, maxEdge / Math.max(width, height))
    // Smaller and smaller until it fits: the size first, then (for a picture with no transparency) JPEG instead of PNG.
    for (let attempt = 0; attempt < 4; attempt++, scale *= 0.75) {
      const w = Math.max(1, Math.round(width * scale))
      const h = Math.max(1, Math.round(height * scale))
      let picture = scale < 1 ? image.resize({ width: w, height: h, quality: 'best' }) : image
      const size = picture.getSize()
      const bitmap = picture.toBitmap()
      if (orientation !== 1) {
        const turned = orientBitmap(bitmap, size.width, size.height, orientation)
        picture = nativeImage.createFromBitmap(turned.data, {
          width: turned.width,
          height: turned.height
        })
      }
      const tries: { type: 'image/png' | 'image/jpeg'; encode: () => Buffer }[] =
        type === 'image/jpeg'
          ? [
              { type: 'image/jpeg', encode: () => picture.toJPEG(90) },
              { type: 'image/jpeg', encode: () => picture.toJPEG(80) }
            ]
          : [
              { type: 'image/png', encode: () => picture.toPNG() },
              ...(opaque(bitmap)
                ? [
                    { type: 'image/jpeg' as const, encode: () => picture.toJPEG(90) },
                    { type: 'image/jpeg' as const, encode: () => picture.toJPEG(80) }
                  ]
                : [])
            ]
      for (const attemptType of tries) {
        const out = attemptType.encode()
        if (out.length > 0 && out.length <= maxBytes) return { bytes: out, type: attemptType.type }
      }
    }
    return null
  },

  thumbnail(bytes, maxEdge) {
    const image = decode(bytes)
    if (image === null) return null
    const { width, height } = image.getSize()
    const scale = Math.min(1, maxEdge / Math.max(width, height))
    const small =
      scale < 1
        ? image.resize({
            width: Math.max(1, Math.round(width * scale)),
            height: Math.max(1, Math.round(height * scale)),
            quality: 'good'
          })
        : image
    return small.toDataURL()
  }
}
