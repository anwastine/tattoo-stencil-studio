/* Shared finishing pass: ink colour, background, mirror, hard threshold. */

export function hexToRgb(hex) {
  const n = parseInt(hex.slice(1), 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

/**
 * Draws `bitmap` into `ctx` at canvas size, then re-inks it:
 * luminance becomes ink opacity, so light pixels drop out and dark ones stay.
 */
export function paintStencil(ctx, bitmap, { ink = '#0b0a09', bg = 'white', mirror = false, threshold = 0 } = {}) {
  const cw = ctx.canvas.width, ch = ctx.canvas.height
  ctx.save()
  ctx.setTransform(1, 0, 0, 1, 0, 0)
  ctx.clearRect(0, 0, cw, ch)
  if (mirror) { ctx.translate(cw, 0); ctx.scale(-1, 1) }
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(bitmap, 0, 0, cw, ch)
  ctx.restore()

  const img = ctx.getImageData(0, 0, cw, ch)
  const d = img.data
  const [ir, ig, ib] = hexToRgb(ink)
  const white = bg === 'white'
  for (let i = 0; i < d.length; i += 4) {
    const lum = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]
    let a = 1 - lum / 255
    if (threshold > 0) a = a > threshold ? 1 : 0
    if (white) {
      d[i] = Math.round(255 + (ir - 255) * a)
      d[i + 1] = Math.round(255 + (ig - 255) * a)
      d[i + 2] = Math.round(255 + (ib - 255) * a)
      d[i + 3] = 255
    } else {
      d[i] = ir; d[i + 1] = ig; d[i + 2] = ib
      d[i + 3] = Math.round(a * 255)
    }
  }
  ctx.putImageData(img, 0, 0)
}

/** Render a bitmap at full size through the finishing pass and download it. */
export async function downloadStencil(bitmap, w, h, opts, filename) {
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  paintStencil(c.getContext('2d', { willReadFrequently: true }), bitmap, opts)
  const blob = await new Promise((r) => c.toBlob(r, 'image/png'))
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 2000)
}
