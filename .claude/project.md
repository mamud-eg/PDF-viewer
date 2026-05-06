# Blueprint Viewer POC

## What this POC is and what it demonstrates

A technology-survey prototype (AJB-14024) for rendering large PDF blueprints in the browser and overlaying interactive *registration marks* on top of the page. It is a single-page React app that loads a PDF (either the bundled `public/sample.pdf` or one uploaded by the user) and renders page 1 in a zoomable, pannable canvas.

The POC demonstrates:

- **Tile-based PDF.js rendering** — the page is split into 512px tiles that are rendered on demand from the visible viewport plus a 1-tile buffer, so memory stays bounded as the user zooms in.
- **Smooth zoom under heavy re-tiling** — visible scale (`scale`) and the scale that tiles are pinned to (`committedScale`) are decoupled. While the user is zooming, existing tiles are CSS-upscaled in a "stale wrap" that is re-parented out of the live tile layer; fresh tiles render off-DOM and atomically swap in once `committedScale` catches up. This avoids the white flash that a naive re-tile produces.
- **Cursor-anchored zoom** — `Ctrl/Cmd + wheel` zooms relative to the cursor; the scroll position is recomputed in a `useLayoutEffect` so the PDF point under the cursor stays put.
- **Right-click panning** — right-mouse-drag pans the underlying scroll container, keeping native scrollbars in sync.
- **Registration-mark overlay** — left-click places a numbered, colored mark in the page's native coordinate space; marks can be dragged, selected (showing an info panel with native x/y), and cleared. Marks persist to `localStorage` so they survive reloads.
- **A "Rendering…" status pill** while the stale wrap is bridging the gap to the new render.

## Tech stack

| Concern | Tool | Version |
| --- | --- | --- |
| UI framework | react | ^19.2.4 |
| UI framework | react-dom | ^19.2.4 |
| PDF rendering | pdfjs-dist | ^3.11.174 |
| Build tool / dev server | vite | ^8.0.4 |
| Vite React plugin | @vitejs/plugin-react | ^6.0.1 |
| Language | typescript | ~6.0.2 |
| Type defs | @types/react | ^19.2.14 |
| Type defs | @types/react-dom | ^19.2.3 |
| Type defs | @types/node | ^24.12.2 |
| Lint | eslint | ^9.39.4 |
| Lint | @eslint/js | ^9.39.4 |
| Lint | typescript-eslint | ^8.58.0 |
| Lint | eslint-plugin-react-hooks | ^7.0.1 |
| Lint | eslint-plugin-react-refresh | ^0.5.2 |
| Lint | globals | ^17.4.0 |

Runtime: any modern Chromium/Firefox/Safari (uses `crypto.randomUUID`, pointer events, and the PDF.js web worker).

## Install and run locally

```sh
npm install
npm run dev       # Vite dev server with HMR (default: http://localhost:5173)
```

Other scripts:

```sh
npm run build     # tsc -b && vite build  → outputs to dist/
npm run preview   # serve the production build
npm run lint      # eslint .
```

To try a different PDF without re-uploading every time, drop it at `public/sample.pdf` (it's served at `/sample.pdf`, which is the default URL `App.tsx` loads). Otherwise click **Upload PDF** in the header and pick any local PDF — it's loaded via `URL.createObjectURL` and never leaves the browser.

## Folder structure

```
PDF-viewer/
├── public/                          # Static assets served at site root
│   ├── sample.pdf                   #   Default PDF loaded on first paint
│   ├── favicon.svg
│   └── icons.svg
├── src/
│   ├── main.tsx                     # App entry: mounts <App /> into #root under StrictMode
│   ├── App.tsx                      # Shell: header, file picker, hosts <PdfJsCanvasViewer />
│   ├── App.css
│   ├── index.css                    # Global styles
│   ├── types.ts                     # RegistrationMark type
│   ├── markUtils.ts                 # ID/color/label generation, hit-testing
│   ├── useMarks.ts                  # Hook: marks state + localStorage persistence
│   ├── MarkInfoPanel.tsx            # Floating panel that appears on a selected mark
│   ├── MarkInfoPanel.css
│   ├── assets/                      # Images imported by source (hero.png, vite.svg, react.svg)
│   └── prototypes/
│       └── PdfJsCanvasViewer/       # The viewer prototype (folder layout leaves room for more)
│           ├── PdfJsCanvasViewer.tsx  # Viewer component: zoom, pan, stale-wrap orchestration
│           ├── PdfJsCanvasViewer.css
│           └── tileRenderer.ts       # Imperative tile cache + PDF.js render-task lifecycle
├── index.html                        # Vite HTML entry — loads /src/main.tsx as a module
├── vite.config.ts                    # Vite config (just `react()` plugin)
├── eslint.config.js                  # Flat ESLint config (JS + TS + react-hooks + react-refresh)
├── tsconfig.json                     # Root: project references only
├── tsconfig.app.json                 # App TS config
├── tsconfig.node.json                # TS config for vite.config.ts
└── package.json
```

The `src/prototypes/` directory exists because this is a tech survey: more prototype viewers can be dropped in alongside `PdfJsCanvasViewer/` and selected from `App.tsx` for comparison.

## Entry point and bootstrap

1. **`index.html`** is the Vite entry. It declares `<div id="root"></div>` and loads `/src/main.tsx` as an ES module.
2. **`src/main.tsx`** calls `createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>)`. Global styles come in via `import './index.css'`.
3. **`src/App.tsx`** owns the `pdfUrl` state (defaults to `/sample.pdf`) and renders `<PdfJsCanvasViewer pdfUrl={pdfUrl} />`. The Upload button swaps `pdfUrl` for an object URL from the chosen file (and revokes the previous one).
4. **`PdfJsCanvasViewer`** sets `pdfjsLib.GlobalWorkerOptions.workerSrc` to the bundled worker (imported as `pdfjs-dist/build/pdf.worker.min.js?url` so Vite emits it as a hashed asset), opens the document with `getDocument(pdfUrl).promise`, fetches page 1, and reads its native viewport size. From there:
   - A `TileRenderer` is constructed against the tile-layer `<div>` and reused across zoom changes.
   - `scale` is what the user sees; `committedScale` is what tiles are rendered at. A 120ms debounce promotes `scale` → `committedScale` once zoom settles.
   - On every `committedScale` change, the previous tile canvases are re-parented into a `pdfjs-stale-wrap`, the renderer is told the new zoom, and fresh tiles render off-DOM. The wrap is dropped when `tileRenderer.onIdle` fires (with a 4s safety timeout as a fallback).
   - Marks are managed by the `useMarks("pdfjs-marks")` hook, which persists to `localStorage` under that key.
