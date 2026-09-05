# Tattoo Stencil Studio

Single-page web app that turns a portrait photo into a tattoo-stencil style
drawing: clean Canny outlines for features and hair, plus dot-work
(stipple / halftone / hatch) shading for the darker areas. Everything runs
locally in the browser inside a Web Worker – no uploads, no server.

## Run locally

Requires Node 18+.

```bash
npm install
npm run dev
```

Then open http://localhost:8801. Drop a JPEG/PNG/WebP on the stage, paste an
image from the clipboard, or click **Try sample**.

Production build:

```bash
npm run build      # outputs static files to dist/
npm run preview    # serves dist/ on :8801
```

`dist/` is plain static HTML/JS – host it on Vercel, Netlify, GitHub Pages,
or any file server.

## AI stencil mode (optional, needs a key)

The **AI stencil** panel sends a downsized copy of the photo to Google's
Gemini image model ("Nano Banana") with a tattoo-stencil prompt and shows the
redrawn result next to the algorithmic one. Five styles (studio, fine line,
bold traditional, dotwork, realism map), 1K/2K/4K output, optional hard
black-and-white threshold, and the same ink/background/mirror export options.

Setup:

1. Create a key at https://aistudio.google.com/apikey
2. Vercel → project → Settings → Environment Variables → add
   `GEMINI_API_KEY` (all environments) → redeploy.
   Optional: `GEMINI_IMAGE_MODEL` (default `gemini-3.1-flash-image`;
   `gemini-3-pro-image` for the highest quality).
3. Locally: `GEMINI_API_KEY=... npm run dev` (the dev server mounts
   `api/stencil.js` at `/api/stencil`).

Cost is roughly $0.05–0.15 per image depending on model and size. The key
never reaches the browser; only the serverless function uses it.

## File structure

```
tattoostencil/
├── index.html               # Vite entry
├── package.json
├── vite.config.js           # React + Tailwind v4 plugins + local /api bridge
├── vercel.json              # function timeout/memory for api/stencil.js
├── api/stencil.js           # Vercel serverless function → Gemini image model
├── public/samples/portrait.jpg   # demo image (public domain)
└── src/
    ├── main.jsx             # React bootstrap
    ├── index.css            # Tailwind import + slider / checkerboard styles
    ├── App.jsx              # UI, state, preview rendering, PNG export
    └── stencil.worker.js    # image pipeline (runs in a Web Worker)
```

## How the processing works (`src/stencil.worker.js`)

1. **Grayscale** – Rec.601 luma.
2. **Tone map** – brightness, contrast, gamma, optional auto-levels.
3. **Lines – "Flow strokes" engine (default)**, a coherent-line-drawing
   pipeline after Kang, Lee & Chui (2007):
   - *Edge tangent flow*: Sobel gradients are rotated 90° and smoothed with a
     separable, magnitude- and direction-weighted filter for N passes, giving
     a vector field that follows hair strands and skin contours.
   - *Flow-guided DoG*: a 1-D difference-of-Gaussians is applied across the
     flow (stroke scale σc, crispness ρ) and the response is integrated along
     the flow for σm pixels (stroke length). Negative responses are lines.
   - The threshold is relative to the image's strongest responses (*Line
     sensitivity*). A second refinement pass re-runs with found lines painted
     in, which joins and sharpens them.
   - Lines are skeletonised to single pixels (Zhang–Suen), specks are
     removed, then the stroke is dilated to the chosen *Line weight*.
4. **Lines – "Canny edges" engine** – blur, Sobel, local-mean gradient
   normalisation, non-maximum suppression, hysteresis. A more technical,
   every-edge look.
5. **Shading** on non-line pixels using a smoothed darkness field with
   threshold, ceiling, falloff and density controls:
   - *Mixed* (default) – stipple for mid tones, cross-hatching for tones
     darker than *Hatch from* (lips, deep shadows).
   - *Stipple* – jittered grid, seeded hash (stable while dragging).
   - *Even* – Floyd–Steinberg error diffusion on a coarse grid.
   - *Halftone* – rotated regular grid, dot area ∝ darkness.
   - *Hatch* – 45° lines, then 135° and horizontal for darker tones.
   Dots are kept off outlines (*Gap from lines*), off very dark areas that
   the strokes already describe (*Ignore darker than*), off line-dense
   regions such as hair (*Skip line-dense areas*) and off a uniform backdrop
   (*Background cut* – flood fill from the photo border).

Export re-runs the whole pipeline at the chosen output width (up to 4000 px)
with all spatial parameters scaled, so lines and dots are crisp rather than
upscaled. Expect ~10–20 s for a 2400 px export. Background can be white or
transparent; *Mirror for transfer* flips the stencil for thermal-paper
transfer.

## Offline tuning harness

`src/defaults.json` mirrors `DEFAULT_PARAMS` and is what the worker's
`processImage()` export expects; you can call it from Node with a raw RGBA
buffer to tune parameters without the browser.
