/*
 * Tattoo Stencil Studio — image processing worker
 * Pure JS / TypedArrays. No OpenCV needed.
 *
 * Line engines
 *  • flow  – Coherent line drawing (Kang et al. 2007): edge tangent flow (ETF)
 *            + flow-guided difference of Gaussians (FDoG), thresholded and
 *            thinned to single strokes. Hair becomes flowing strands, skin
 *            contours become smooth single lines. This is the default.
 *  • canny – classic Canny (Sobel → NMS → hysteresis) for a more technical,
 *            "every edge" look.
 *
 * Shading (on non-line pixels only)
 *  stipple / diffusion (even) / halftone / hatch / mixed (stipple + hatch on
 *  the darkest tones). Dots are kept off outlines, off a uniform backdrop
 *  (flood fill) and off line-dense regions such as hair.
 */

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v)

function hash2(x, y, seed) {
  let h = (x * 374761393 + y * 668265263 + seed * 982451653) | 0
  h = Math.imul(h ^ (h >>> 13), 1274126177)
  h ^= h >>> 16
  return (h >>> 0) / 4294967296
}

/* ------------------------------------------------------------------ */
/*  basic filters                                                      */
/* ------------------------------------------------------------------ */

function toGray(rgba, w, h) {
  const g = new Float32Array(w * h)
  for (let i = 0, j = 0; i < g.length; i++, j += 4) g[i] = 0.299 * rgba[j] + 0.587 * rgba[j + 1] + 0.114 * rgba[j + 2]
  return g
}

function toneMap(gray, brightness, contrast, gamma) {
  const out = new Float32Array(gray.length)
  const invG = 1 / gamma
  for (let i = 0; i < gray.length; i++) {
    let v = (gray[i] - 128) * contrast + 128 + brightness
    v = clamp(v, 0, 255) / 255
    out[i] = Math.pow(v, invG) * 255
  }
  return out
}

// stretch so that the 1st..99th percentile spans 0..255
function autoLevels(src) {
  const hist = new Uint32Array(256)
  for (let i = 0; i < src.length; i++) hist[src[i] | 0]++
  const n = src.length
  let lo = 0, hi = 255, acc = 0
  for (let b = 0; b < 256; b++) { acc += hist[b]; if (acc >= n * 0.01) { lo = b; break } }
  acc = 0
  for (let b = 255; b >= 0; b--) { acc += hist[b]; if (acc >= n * 0.01) { hi = b; break } }
  if (hi - lo < 20) return src
  const out = new Float32Array(n)
  const k = 255 / (hi - lo)
  for (let i = 0; i < n; i++) out[i] = clamp((src[i] - lo) * k, 0, 255)
  return out
}

function gaussianKernel(sigma) {
  const r = Math.max(1, Math.ceil(sigma * 3))
  const k = new Float32Array(2 * r + 1)
  let sum = 0
  for (let i = -r; i <= r; i++) { const v = Math.exp(-(i * i) / (2 * sigma * sigma)); k[i + r] = v; sum += v }
  for (let i = 0; i < k.length; i++) k[i] /= sum
  return { k, r }
}

function blur(src, w, h, sigma) {
  if (sigma <= 0.05) return Float32Array.from(src)
  const { k, r } = gaussianKernel(sigma)
  const tmp = new Float32Array(w * h)
  const out = new Float32Array(w * h)
  for (let y = 0; y < h; y++) {
    const row = y * w
    for (let x = 0; x < w; x++) {
      let acc = 0
      for (let i = -r; i <= r; i++) acc += src[row + clamp(x + i, 0, w - 1)] * k[i + r]
      tmp[row + x] = acc
    }
  }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let acc = 0
      for (let i = -r; i <= r; i++) acc += tmp[clamp(y + i, 0, h - 1) * w + x] * k[i + r]
      out[y * w + x] = acc
    }
  }
  return out
}

function boxMean(src, w, h, r) {
  const W = w + 1
  const sat = new Float64Array(W * (h + 1))
  for (let y = 1; y <= h; y++) {
    let row = 0
    for (let x = 1; x <= w; x++) { row += src[(y - 1) * w + (x - 1)]; sat[y * W + x] = sat[(y - 1) * W + x] + row }
  }
  const out = new Float32Array(w * h)
  for (let y = 0; y < h; y++) {
    const y0 = Math.max(0, y - r), y1 = Math.min(h, y + r + 1)
    for (let x = 0; x < w; x++) {
      const x0 = Math.max(0, x - r), x1 = Math.min(w, x + r + 1)
      out[y * w + x] = (sat[y1 * W + x1] - sat[y0 * W + x1] - sat[y1 * W + x0] + sat[y0 * W + x0]) / ((y1 - y0) * (x1 - x0))
    }
  }
  return out
}

function sobel(src, w, h) {
  const gx = new Float32Array(w * h), gy = new Float32Array(w * h), mag = new Float32Array(w * h)
  const dir = new Uint8Array(w * h)
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x
      const a = src[i - w - 1], b = src[i - w], c = src[i - w + 1]
      const d = src[i - 1], f = src[i + 1]
      const g = src[i + w - 1], hh = src[i + w], k = src[i + w + 1]
      const vx = -a + c - 2 * d + 2 * f - g + k
      const vy = -a - 2 * b - c + g + 2 * hh + k
      gx[i] = vx; gy[i] = vy
      mag[i] = Math.hypot(vx, vy)
      let ang = Math.atan2(vy, vx) * (180 / Math.PI)
      if (ang < 0) ang += 180
      dir[i] = ang < 22.5 || ang >= 157.5 ? 0 : ang < 67.5 ? 1 : ang < 112.5 ? 2 : 3
    }
  }
  return { gx, gy, mag, dir }
}

function percentile(arr, pct, onlyPositive = true) {
  const bins = 1024
  const hist = new Uint32Array(bins)
  let max = 0
  for (let i = 0; i < arr.length; i++) if (arr[i] > max) max = arr[i]
  if (max === 0) return 0
  let n = 0
  for (let i = 0; i < arr.length; i++) {
    const v = arr[i]
    if (onlyPositive && v <= 0) continue
    hist[Math.min(bins - 1, (v / max * (bins - 1)) | 0)]++
    n++
  }
  let acc = 0
  for (let b = 0; b < bins; b++) { acc += hist[b]; if (acc >= n * pct) return (b / (bins - 1)) * max }
  return max
}

/* ------------------------------------------------------------------ */
/*  binary morphology                                                  */
/* ------------------------------------------------------------------ */

function dilate(mask, w, h, radius) {
  if (radius <= 0) return mask
  const r = Math.ceil(radius), r2 = radius * radius
  const out = new Uint8Array(w * h)
  const offs = []
  for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) if (dx * dx + dy * dy <= r2 + 0.01) offs.push(dx, dy)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!mask[y * w + x]) continue
      for (let o = 0; o < offs.length; o += 2) {
        const xx = x + offs[o], yy = y + offs[o + 1]
        if (xx >= 0 && xx < w && yy >= 0 && yy < h) out[yy * w + xx] = 1
      }
    }
  }
  return out
}

function removeSpeckles(edges, w, h, minLen) {
  if (minLen <= 1) return edges
  const seen = new Uint8Array(w * h)
  const stack = new Int32Array(w * h)
  const comp = new Int32Array(w * h)
  for (let i = 0; i < edges.length; i++) {
    if (!edges[i] || seen[i]) continue
    let sp = 0, n = 0
    stack[sp++] = i; seen[i] = 1
    while (sp > 0) {
      const p = stack[--sp]
      comp[n++] = p
      const px = p % w, py = (p / w) | 0
      for (let dy = -1; dy <= 1; dy++) {
        const yy = py + dy
        if (yy < 0 || yy >= h) continue
        for (let dx = -1; dx <= 1; dx++) {
          const xx = px + dx
          if (xx < 0 || xx >= w) continue
          const q = yy * w + xx
          if (edges[q] && !seen[q]) { seen[q] = 1; stack[sp++] = q }
        }
      }
    }
    if (n < minLen) for (let k = 0; k < n; k++) edges[comp[k]] = 0
  }
  return edges
}

// Zhang–Suen thinning → 1px skeleton
function thin(mask, w, h) {
  const img = Uint8Array.from(mask)
  const del = []
  let changed = true
  while (changed) {
    changed = false
    for (let pass = 0; pass < 2; pass++) {
      del.length = 0
      for (let y = 1; y < h - 1; y++) {
        for (let x = 1; x < w - 1; x++) {
          const i = y * w + x
          if (!img[i]) continue
          const p2 = img[i - w], p3 = img[i - w + 1], p4 = img[i + 1], p5 = img[i + w + 1]
          const p6 = img[i + w], p7 = img[i + w - 1], p8 = img[i - 1], p9 = img[i - w - 1]
          const B = p2 + p3 + p4 + p5 + p6 + p7 + p8 + p9
          if (B < 2 || B > 6) continue
          let A = 0
          if (!p2 && p3) A++; if (!p3 && p4) A++; if (!p4 && p5) A++; if (!p5 && p6) A++
          if (!p6 && p7) A++; if (!p7 && p8) A++; if (!p8 && p9) A++; if (!p9 && p2) A++
          if (A !== 1) continue
          if (pass === 0) { if (p2 * p4 * p6 !== 0 || p4 * p6 * p8 !== 0) continue }
          else if (p2 * p4 * p8 !== 0 || p2 * p6 * p8 !== 0) continue
          del.push(i)
        }
      }
      if (del.length) { changed = true; for (const i of del) img[i] = 0 }
    }
  }
  return img
}

/* ------------------------------------------------------------------ */
/*  Canny                                                              */
/* ------------------------------------------------------------------ */

function localNormalize(mag, w, h, amount) {
  if (amount <= 0) return mag
  const r = Math.max(8, Math.round(Math.max(w, h) / 24))
  const local = boxMean(mag, w, h, r)
  let g = 0
  for (let i = 0; i < mag.length; i++) g += mag[i]
  g /= mag.length
  const out = new Float32Array(mag.length)
  for (let i = 0; i < mag.length; i++) out[i] = (mag[i] * g) / (amount * local[i] + (1 - amount) * g + 1e-3)
  return out
}

function nonMaxSuppression(mag, dir, w, h) {
  const out = new Float32Array(w * h)
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x
      const m = mag[i]
      if (m === 0) continue
      let p, q
      switch (dir[i]) {
        case 0: p = mag[i - 1]; q = mag[i + 1]; break
        case 1: p = mag[i - w - 1]; q = mag[i + w + 1]; break
        case 2: p = mag[i - w]; q = mag[i + w]; break
        default: p = mag[i - w + 1]; q = mag[i + w - 1]
      }
      if (m >= p && m >= q) out[i] = m
    }
  }
  return out
}

function hysteresis(nms, w, h, low, high) {
  const edges = new Uint8Array(w * h)
  const stack = new Int32Array(w * h)
  let sp = 0
  for (let i = 0; i < nms.length; i++) {
    if (nms[i] >= high && !edges[i]) {
      edges[i] = 1; stack[sp++] = i
      while (sp > 0) {
        const p = stack[--sp]
        const px = p % w, py = (p / w) | 0
        for (let dy = -1; dy <= 1; dy++) {
          const yy = py + dy
          if (yy < 0 || yy >= h) continue
          for (let dx = -1; dx <= 1; dx++) {
            const xx = px + dx
            if (xx < 0 || xx >= w) continue
            const q = yy * w + xx
            if (!edges[q] && nms[q] >= low) { edges[q] = 1; stack[sp++] = q }
          }
        }
      }
    }
  }
  return edges
}

function cannyLines(tone, w, h, p) {
  const blurred = blur(tone, w, h, p.blurSigma)
  const { mag: rawMag, dir } = sobel(blurred, w, h)
  const mag = localNormalize(rawMag, w, h, p.localBalance)
  const nms = nonMaxSuppression(mag, dir, w, h)
  const p99 = percentile(nms, 0.99)
  const frac = 0.6 + (0.035 - 0.6) * p.edgeSensitivity
  const high = Math.max(p99 * frac, 8)
  return hysteresis(nms, w, h, high * p.hysteresisRatio, high)
}

/* ------------------------------------------------------------------ */
/*  Coherent line drawing: ETF + FDoG                                  */
/* ------------------------------------------------------------------ */

const etfCache = new Map() // key → { tx, ty }, a few recent sizes/settings

function imageKey(gray, w, h, extra) {
  let s = 0
  const step = Math.max(1, (gray.length / 4096) | 0)
  for (let i = 0; i < gray.length; i += step) s = (s * 31 + (gray[i] | 0)) | 0
  return `${w}x${h}:${s}:${extra}`
}

function computeETF(gray, w, h, sigma, radius, iters) {
  const src = blur(gray, w, h, sigma)
  const { gx, gy, mag } = sobel(src, w, h)
  let max = 0
  for (let i = 0; i < mag.length; i++) if (mag[i] > max) max = mag[i]
  const g = new Float32Array(w * h)
  let tx = new Float32Array(w * h), ty = new Float32Array(w * h)
  for (let i = 0; i < mag.length; i++) {
    g[i] = max ? mag[i] / max : 0
    if (mag[i] > 1e-6) { tx[i] = -gy[i] / mag[i]; ty[i] = gx[i] / mag[i] }
  }
  const r = radius
  // (1 + tanh(d)) / 2 for d in [-1, 1] via lookup table
  const LUT_N = 1024
  const lut = new Float32Array(LUT_N + 1)
  for (let i = 0; i <= LUT_N; i++) lut[i] = (1 + Math.tanh((i / LUT_N) * 2 - 1)) * 0.5
  let ntx = new Float32Array(w * h), nty = new Float32Array(w * h)
  const pass = (horizontal) => {
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = y * w + x
        const cx = tx[i], cy = ty[i]
        const zero = cx === 0 && cy === 0
        let sx = 0, sy = 0
        for (let k = -r; k <= r; k++) {
          const j = horizontal ? y * w + clamp(x + k, 0, w - 1) : clamp(y + k, 0, h - 1) * w + x
          const ox = tx[j], oy = ty[j]
          if (ox === 0 && oy === 0) continue
          const wm = lut[((g[j] - g[i] + 1) * 0.5 * LUT_N) | 0]
          let wgt
          if (zero) wgt = wm
          else {
            const dot = cx * ox + cy * oy
            wgt = (dot >= 0 ? 1 : -1) * wm * Math.abs(dot)
          }
          sx += ox * wgt; sy += oy * wgt
        }
        const len = Math.hypot(sx, sy)
        if (len > 1e-6) { ntx[i] = sx / len; nty[i] = sy / len } else { ntx[i] = cx; nty[i] = cy }
      }
    }
    ;[tx, ntx] = [ntx, tx]
    ;[ty, nty] = [nty, ty]
  }
  for (let it = 0; it < iters; it++) { pass(true); pass(false) }
  return { tx, ty }
}

function sampleBilinear(img, w, h, x, y) {
  x = clamp(x, 0, w - 1.001); y = clamp(y, 0, h - 1.001)
  const x0 = x | 0, y0 = y | 0, fx = x - x0, fy = y - y0
  const i = y0 * w + x0
  return (img[i] * (1 - fx) + img[i + 1] * fx) * (1 - fy) + (img[i + w] * (1 - fx) + img[i + w + 1] * fx) * fy
}

// returns He: negative where a line runs through the pixel
function fdogResponse(I, tx, ty, w, h, sigmaC, rho, sigmaM) {
  const sigmaS = 1.6 * sigmaC
  const T = Math.ceil(2.5 * sigmaS)
  const f = new Float32Array(2 * T + 1)
  const gc = 1 / (Math.sqrt(2 * Math.PI) * sigmaC), gs = 1 / (Math.sqrt(2 * Math.PI) * sigmaS)
  for (let s = -T; s <= T; s++) f[s + T] = gc * Math.exp(-(s * s) / (2 * sigmaC * sigmaC)) - rho * gs * Math.exp(-(s * s) / (2 * sigmaS * sigmaS))
  // 1. DoG across the flow (along the gradient)
  const Hg = new Float32Array(w * h)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x
      const nx = ty[i], ny = -tx[i]
      if (nx === 0 && ny === 0) continue
      let acc = 0
      // nearest-neighbour sampling along the gradient (≈2.5× faster than
      // bilinear; the flow integration below smooths the aliasing away)
      for (let s = -T; s <= T; s++) {
        const sx = (x + s * nx + 0.5) | 0, sy = (y + s * ny + 0.5) | 0
        acc += f[s + T] * I[clamp(sy, 0, h - 1) * w + clamp(sx, 0, w - 1)]
      }
      Hg[i] = acc
    }
  }
  // 2. integrate along the flow
  const S = Math.ceil(3 * sigmaM)
  const gm = new Float32Array(S + 1)
  for (let k = 0; k <= S; k++) gm[k] = Math.exp(-(k * k) / (2 * sigmaM * sigmaM))
  const He = new Float32Array(w * h)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x
      let acc = gm[0] * Hg[i], wsum = gm[0]
      for (let dirn = -1; dirn <= 1; dirn += 2) {
        let px = x, py = y, dx = tx[i] * dirn, dy = ty[i] * dirn
        if (dx === 0 && dy === 0) continue
        for (let k = 1; k <= S; k++) {
          px += dx; py += dy
          if (px < 0 || py < 0 || px >= w - 1 || py >= h - 1) break
          const j = Math.round(py) * w + Math.round(px)
          let ox = tx[j], oy = ty[j]
          if (ox === 0 && oy === 0) break
          if (ox * dx + oy * dy < 0) { ox = -ox; oy = -oy }
          dx = ox; dy = oy
          acc += gm[k] * Hg[j]; wsum += gm[k]
        }
      }
      He[i] = acc / wsum
    }
  }
  return He
}

function flowLines(gray, tone, w, h, p, mark = () => {}) {
  const key = imageKey(gray, w, h, `${p.blurSigma}|${p.etfRadius}|${p.etfIters}`)
  if (!etfCache.has(key)) {
    etfCache.set(key, computeETF(gray, w, h, p.blurSigma, p.etfRadius, p.etfIters))
    if (etfCache.size > 4) etfCache.delete(etfCache.keys().next().value)
    mark('etf')
  }
  const { tx, ty } = etfCache.get(key)
  // work on a lightly smoothed, 0..1 image
  const base = blur(tone, w, h, Math.max(0.3, p.blurSigma * 0.5))
  const I = new Float32Array(w * h)
  for (let i = 0; i < I.length; i++) I[i] = base[i] / 255
  let edges = null
  for (let it = 0; it < p.fdogIters; it++) {
    const He = fdogResponse(I, tx, ty, w, h, p.sigmaC, p.rho, p.sigmaM)
    mark('fdog' + it)
    const neg = new Float32Array(w * h)
    for (let i = 0; i < neg.length; i++) neg[i] = He[i] < 0 ? -He[i] : 0
    const ref = percentile(neg, 0.985)
    const u = 1 - p.edgeSensitivity
    const thr = ref * (0.3 * u * u + 0.01)
    edges = new Uint8Array(w * h)
    for (let i = 0; i < neg.length; i++) if (neg[i] > thr) edges[i] = 1
    if (it < p.fdogIters - 1) for (let i = 0; i < I.length; i++) if (edges[i]) I[i] = 0
  }
  return edges
}

/* ------------------------------------------------------------------ */
/*  background & shading                                               */
/* ------------------------------------------------------------------ */

function backgroundMask(tone, w, h, tol) {
  if (tol <= 0) return null
  const soft = blur(tone, w, h, 2)
  const border = []
  for (let x = 0; x < w; x++) border.push(soft[x], soft[(h - 1) * w + x])
  for (let y = 0; y < h; y++) border.push(soft[y * w], soft[y * w + w - 1])
  border.sort((a, b) => a - b)
  const ref = border[border.length >> 1]
  const T = tol * 255
  const mask = new Uint8Array(w * h)
  const stack = new Int32Array(w * h)
  let sp = 0
  const seed = (i) => { if (!mask[i] && Math.abs(soft[i] - ref) < T) { mask[i] = 1; stack[sp++] = i } }
  for (let x = 0; x < w; x++) { seed(x); seed((h - 1) * w + x) }
  for (let y = 0; y < h; y++) { seed(y * w); seed(y * w + w - 1) }
  while (sp > 0) {
    const i = stack[--sp]
    const x = i % w, y = (i / w) | 0
    if (x > 0) seed(i - 1)
    if (x < w - 1) seed(i + 1)
    if (y > 0) seed(i - w)
    if (y < h - 1) seed(i + w)
  }
  return dilate(mask, w, h, 2)
}

function shadeField(tone, w, h, p) {
  const soft = blur(tone, w, h, Math.max(0.6, p.shadeSmooth))
  const s = new Float32Array(w * h)
  const thr = p.shadeThreshold, gam = p.shadeGamma
  for (let i = 0; i < s.length; i++) {
    const dark = 1 - soft[i] / 255
    if (dark > p.shadeMax) { s[i] = 0; continue }
    let v = (dark - thr) / (1 - thr)
    if (v <= 0) { s[i] = 0; continue }
    s[i] = clamp(Math.pow(v, gam) * p.shadeStrength, 0, 1)
  }
  return s
}

function stippleJittered(s, keep, w, h, p, maxS = 1.01) {
  const dots = []
  const cell = Math.max(1.5, p.dotSpacing * 0.55)
  const seed = p.seed | 0
  const cols = Math.ceil(w / cell), rows = Math.ceil(h / cell)
  for (let cy = 0; cy < rows; cy++) {
    for (let cx = 0; cx < cols; cx++) {
      const x = (cx + hash2(cx, cy, seed)) * cell, y = (cy + hash2(cx, cy, seed + 7)) * cell
      const xi = x | 0, yi = y | 0
      if (xi >= w || yi >= h) continue
      const i = yi * w + xi
      if (!keep[i]) continue
      const v = s[i]
      if (v <= 0 || v >= maxS) continue
      if (hash2(cx, cy, seed + 13) > Math.pow(v, 1.2)) continue
      dots.push(x, y, p.dotSize * (0.6 + 0.4 * v))
    }
  }
  return dots
}

function stippleDiffusion(s, keep, w, h, p) {
  const cell = Math.max(1.5, p.dotSpacing * 0.55)
  const cols = Math.ceil(w / cell), rows = Math.ceil(h / cell)
  const grid = new Float32Array(cols * rows)
  const gk = new Uint8Array(cols * rows)
  for (let cy = 0; cy < rows; cy++) {
    for (let cx = 0; cx < cols; cx++) {
      const x = Math.min(w - 1, ((cx + 0.5) * cell) | 0), y = Math.min(h - 1, ((cy + 0.5) * cell) | 0)
      const i = y * w + x
      grid[cy * cols + cx] = keep[i] ? s[i] : 0
      gk[cy * cols + cx] = keep[i]
    }
  }
  const dots = []
  const seed = p.seed | 0
  for (let cy = 0; cy < rows; cy++) {
    for (let cx = 0; cx < cols; cx++) {
      const gi = cy * cols + cx
      const old = grid[gi]
      const on = old >= 0.5 ? 1 : 0
      const err = old - on
      if (cx + 1 < cols) grid[gi + 1] += err * 7 / 16
      if (cy + 1 < rows) {
        if (cx > 0) grid[gi + cols - 1] += err * 3 / 16
        grid[gi + cols] += err * 5 / 16
        if (cx + 1 < cols) grid[gi + cols + 1] += err * 1 / 16
      }
      if (on && gk[gi]) {
        const x = (cx + 0.5) * cell + (hash2(cx, cy, seed) - 0.5) * cell * 0.6
        const y = (cy + 0.5) * cell + (hash2(cx, cy, seed + 7) - 0.5) * cell * 0.6
        const v = s[clamp(y | 0, 0, h - 1) * w + clamp(x | 0, 0, w - 1)]
        dots.push(x, y, p.dotSize * (0.6 + 0.4 * v))
      }
    }
  }
  return dots
}

function halftone(s, keep, w, h, p) {
  const cell = Math.max(2, p.dotSpacing)
  const ang = (p.halftoneAngle * Math.PI) / 180
  const ca = Math.cos(ang), sa = Math.sin(ang)
  const dots = []
  const n = Math.ceil(Math.hypot(w, h) / cell) + 2
  const cxm = w / 2, cym = h / 2
  for (let gy = -n; gy <= n; gy++) {
    for (let gx = -n; gx <= n; gx++) {
      const ux = gx * cell, uy = gy * cell
      const x = cxm + ux * ca - uy * sa, y = cym + ux * sa + uy * ca
      if (x < 0 || y < 0 || x >= w || y >= h) continue
      const i = (y | 0) * w + (x | 0)
      if (!keep[i]) continue
      const v = s[i]
      if (v <= 0.02) continue
      const r = (cell / 2) * Math.sqrt(v) * p.dotSize * 0.55
      if (r >= 0.35) dots.push(x, y, r)
    }
  }
  return dots
}

// thresholds: darkness levels at which the 45°, 135° and 0° passes start
function hatch(s, keep, w, h, p, thresholds) {
  const segs = []
  const cell = Math.max(2, p.dotSpacing)
  const passes = [{ ang: 45, thr: thresholds[0] }, { ang: 135, thr: thresholds[1] }, { ang: 0, thr: thresholds[2] }]
  const diag = Math.hypot(w, h)
  for (const pass of passes) {
    if (pass.thr > 1) continue
    const a = (pass.ang * Math.PI) / 180
    const dx = Math.cos(a), dy = Math.sin(a), nx = -dy, ny = dx
    const cxm = w / 2, cym = h / 2
    const nLines = Math.ceil(diag / cell)
    for (let li = -nLines; li <= nLines; li++) {
      const ox = cxm + nx * li * cell, oy = cym + ny * li * cell
      let inSeg = false, sx = 0, sy = 0, acc = 0, cnt = 0
      for (let t = -diag / 2; t <= diag / 2; t += 1) {
        const x = ox + dx * t, y = oy + dy * t
        let on = false, v = 0
        if (x >= 0 && y >= 0 && x < w && y < h) {
          const i = (y | 0) * w + (x | 0)
          v = keep[i] ? s[i] : 0
          on = v > pass.thr
        }
        if (on && !inSeg) { inSeg = true; sx = x; sy = y; acc = 0; cnt = 0 }
        if (on) { acc += v; cnt++ }
        if (!on && inSeg) {
          inSeg = false
          if (cnt >= 3) segs.push(sx, sy, x, y, p.dotSize * (0.35 + 0.65 * (acc / cnt)))
        }
      }
    }
  }
  return segs
}

/* ------------------------------------------------------------------ */
/*  main                                                               */
/* ------------------------------------------------------------------ */

export function processImage(rgba, w, h, p, timings = null) {
  const t0 = performance.now()
  const mark = (label) => { if (timings) timings.push([label, Math.round(performance.now() - t0)]) }

  const gray = toGray(rgba, w, h)
  let tone = toneMap(gray, p.brightness, p.contrast, p.gamma)
  if (p.autoLevels) tone = autoLevels(tone)
  mark('tone')

  // --- lines ---
  let edges = p.lineEngine === 'canny' ? cannyLines(tone, w, h, p) : flowLines(gray, tone, w, h, p, mark)
  mark('lines')
  if (p.lineEngine !== 'canny' && p.thinLines) edges = thin(edges, w, h)
  mark('thin')
  edges = removeSpeckles(edges, w, h, p.minEdgeLength)
  mark('speckles')
  const thinEdges = edges
  const lineR = (p.lineWeight - 1) / 2
  if (lineR > 0) edges = dilate(edges, w, h, lineR)

  // --- shading ---
  let dots = [], segs = []
  if (p.shadeMode !== 'none' && p.shadeStrength > 0) {
    const s = shadeField(tone, w, h, p)
    const keep = new Uint8Array(w * h)
    const avoid = p.edgeAvoid > 0 ? dilate(thinEdges, w, h, p.edgeAvoid + lineR) : edges
    const bg = backgroundMask(tone, w, h, p.bgCut)
    // line-dense regions (hair, fabric) are already "drawn" by strokes
    let dense = null
    if (p.lineDensityCut > 0) {
      const r = Math.max(4, Math.round(p.dotSpacing * 1.3))
      const d = boxMean(thinEdges, w, h, r)
      dense = new Uint8Array(w * h)
      for (let i = 0; i < d.length; i++) if (d[i] > p.lineDensityCut) dense[i] = 1
      dense = dilate(dense, w, h, r * 0.5)
    }
    for (let i = 0; i < keep.length; i++) keep[i] = avoid[i] || (bg && bg[i]) || (dense && dense[i]) ? 0 : 1
    switch (p.shadeMode) {
      case 'stipple': dots = stippleJittered(s, keep, w, h, p); break
      case 'diffusion': dots = stippleDiffusion(s, keep, w, h, p); break
      case 'halftone': dots = halftone(s, keep, w, h, p); break
      case 'hatch': segs = hatch(s, keep, w, h, p, [0.12, 0.5, 0.8]); break
      case 'mixed': {
        const hf = p.hatchFrom
        dots = stippleJittered(s, keep, w, h, p, hf)
        segs = hatch(s, keep, w, h, p, [hf, hf + (1 - hf) * 0.45, 2])
        break
      }
    }
  }

  mark('shading')
  return { edges, dots: Float32Array.from(dots), segs: Float32Array.from(segs), ms: performance.now() - t0 }
}

if (typeof self !== 'undefined' && typeof self.postMessage === 'function') {
  self.onmessage = (e) => {
    const { id, width: w, height: h, buffer, params } = e.data
    const timings = []
    const r = processImage(new Uint8ClampedArray(buffer), w, h, params, timings)
    self.postMessage(
      { id, width: w, height: h, edges: r.edges.buffer, dots: r.dots.buffer, segs: r.segs.buffer, ms: r.ms, timings, dotCount: r.dots.length / 3, segCount: r.segs.length / 5 },
      [r.edges.buffer, r.dots.buffer, r.segs.buffer],
    )
  }
}
