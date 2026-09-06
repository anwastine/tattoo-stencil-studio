# Tattoo Stencil Studio

Upload a portrait photo, pick a style, and an image-to-image AI model
redraws it as a hand-inked tattoo stencil: clean outlines, dot-work shading,
cross-hatched darks, pure black on white. Clean it up, recolour it, mirror
it for transfer and export a full-resolution PNG.

Live: https://tattoo-stencil-studio-kappa.vercel.app

## How it works

1. The browser downsizes the photo (long side 1536 px) and POSTs it to
   `/api/stencil`, a Vercel serverless function.
2. The function sends it with a style-specific tattoo-artist prompt to
   **OpenAI GPT Image** (`gpt-image-2` via `/v1/images/edits`) or
   **Google Gemini** image model (`gemini-3.1-flash-image`), whichever key is
   configured, and returns the drawing as PNG.
3. The browser shows it next to the original (split compare), applies
   optional clean-up (hard black-and-white threshold, ink colour, white or
   transparent background, mirror) and exports it at the generated size
   (1K / 2K / 4K).

Styles: Studio stencil, Fine line, Bold traditional, Dotwork, Realism map.

## Setup

Set at least one key in Vercel → project → Settings → Environment Variables,
then redeploy:

| Variable | Where to get it |
| --- | --- |
| `OPENAI_API_KEY` | https://platform.openai.com/api-keys (billing required) |
| `GEMINI_API_KEY` | https://aistudio.google.com/apikey |

Optional overrides: `OPENAI_IMAGE_MODEL`, `GEMINI_IMAGE_MODEL`.

Rough cost per image with OpenAI: 5¢ at 1K, 20¢ at 2K, more at 4K.
Keys never reach the browser.

## Run locally

```bash
npm install
OPENAI_API_KEY=sk-... npm run dev     # http://localhost:8801
```

The dev server mounts `api/stencil.js` at `/api/stencil` so the full flow
works locally. `npm run build` outputs static files to `dist/`.

## Files

```
index.html, vite.config.js, vercel.json, package.json
api/stencil.js        serverless function → OpenAI / Gemini image models
src/App.jsx           the whole UI
src/index.css         Tailwind + slider/checkerboard styles
public/samples/       demo portrait
```

Deployed from GitHub `anwastine/tattoo-stencil-studio`; every push to `main`
redeploys.
