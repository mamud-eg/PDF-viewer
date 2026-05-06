# Blueprint Viewer POC — Context

## Why this POC was built

This POC was scoped under **AJB-14024** as a *technology survey*. The header copy in `App.tsx` calls it out explicitly: *"Technology survey: PDF rendering with registration mark overlay."*

The problem it explores: how to render large engineering/construction blueprints (PDF) in a browser at high zoom, while letting a user place, drag, and inspect *registration marks* on top of the page in the page's own coordinate system. The challenges this surfaces are:

- Browsers can't render a 16× zoomed PDF page into a single `<canvas>` — the canvas hits the browser's max-bitmap limit and falls over.
- Re-rendering on every zoom tick is too slow; PDF.js render tasks are expensive.
- Naive re-tiling produces a visible white flash where the old tiles have been removed but the new ones haven't drawn yet.
- Marks have to live in PDF coordinates (so they stay anchored to features as the user zooms) but be hit-tested and dragged in screen coordinates.

The POC's job is to prove this is feasible in `pdfjs-dist` + React 19 before committing to it for a production viewer, and to capture the design choices for a follow-up implementation.

## What success looks like

The POC is successful if a developer reading it can answer *yes* to all of these:

- Loads a PDF (bundled `sample.pdf` or user-uploaded) and renders page 1 sharply at zoom levels from 0.5× to 16×.
- Zoom under `Ctrl/Cmd + wheel` is anchored to the cursor (the PDF point under the pointer doesn't move), and the page stays visible — no white flash — across the re-tile.
- Right-click drag pans without disturbing scroll-bar state; `Ctrl/Cmd + wheel` zooms.
- Left-click on the page places a numbered, colored mark at the correct PDF coordinate; the same mark stays glued to that coordinate at every zoom level.
- Marks can be dragged (left-mouse) without accidentally being treated as a click, and clicking a mark opens an info panel showing its native x/y.
- Marks survive a full page reload (persisted to `localStorage`).
- The implementation is small enough — under ~700 LoC across the viewer, tile renderer, marks hook, and styles — that a production rewrite can be informed by it without inheriting it.

## Key architectural and design decisions

### 1. PDF.js + tile-based rendering, not a single canvas
`tileRenderer.ts` splits the page into 512px tiles and only renders the visible tiles plus a 1-tile buffer. At 16× a 1000×1400 native page becomes 16000×22400 — a single canvas of that size is not realistic. Tiles also let us cancel and discard work cheaply when zoom changes.

### 2. Imperative `TileRenderer` class, declarative React shell
`TileRenderer` directly owns DOM canvases and the PDF.js render-task lifecycle; React only owns *configuration* (zoom, scroll, page) and reads back via callbacks. We tried to keep React out of the per-tile lifecycle because reconciliation against hundreds of tile nodes that each contain a live `<canvas>` (with state we don't want to remount) is the wrong fit.

### 3. Decoupled `scale` vs `committedScale` (debounced re-tile)
The user's wheel produces continuous scale changes; we don't want to ask PDF.js to re-render on every tick. The visible scale (`scale`) updates instantly; the *committed* scale that tiles are pinned to (`committedScale`) only catches up after 120ms of no further zoom (`PdfJsCanvasViewer.tsx:150-154`). In the meantime the existing tile layer is CSS-transformed to bridge the gap.

### 4. The "stale wrap" trick to kill the white flash
The single nastiest detail in the file. When `committedScale` changes, we:
1. Re-parent the existing (drawn) tile canvases out of the live tile-layer into a `.pdfjs-stale-wrap` div.
2. Size the wrap to the *old* committed scale and CSS-`transform: scale()` it to the *current* visible scale.
3. Tell `TileRenderer` the new zoom — it forgets the cache and starts rendering fresh tiles off-DOM.
4. Each new tile attaches atomically (`appendChild`) only when its render-task resolves, so the live tile-layer never contains a transparent in-flight canvas.
5. When the renderer reports idle (`onIdle`), drop the wrap.

The combination is what produces a smooth zoom: the user always sees *something* on the page, transitioning from "old bitmap, scaled up" to "new bitmap, sharp."

### 5. Off-DOM tile rendering, atomic attach
A canvas that is in the DOM but hasn't been drawn yet is transparent — the white `.pdfjs-page` background bleeds through. So tiles are created, given a render task, and only `appendChild`'d in the task's resolve callback. This is documented inline in `tileRenderer.ts:155-157`.

### 6. SVG overlay for marks (not canvas)
Marks are small, sparse, interactive, and need per-element hit-testing, drag, and stroke styles. SVG gives us this for free with native pointer events, while a canvas overlay would mean re-implementing hit-testing and re-drawing on every zoom tick. The number of marks a real user produces is small enough that SVG rendering cost is negligible.

### 7. Marks stored in PDF-native coordinates
`RegistrationMark.x/y` are in the page's native (scale=1) viewport units. On render we multiply by `scaleX`/`scaleY` to project to screen. This means zooming, panning, and serializing all work without rounding, and marks survive a viewer rewrite.

### 8. Cursor-anchored zoom via `useLayoutEffect`
`zoomAnchorRef` captures cursor position + scroll on the wheel event; a `useLayoutEffect` keyed to `[scale, native]` adjusts `scrollLeft`/`scrollTop` *before paint* using a closed-form formula. Doing this in `useEffect` would let one frame paint at the wrong position and cause a visible jump.

### 9. Right-click drag for panning
Mouse-down is captured at `e.button === 2`; the context menu is suppressed inside the scroll container. This frees left-click exclusively for mark placement and selection — no spacebar-to-pan modal mode needed.

### 10. `useMarks` hook + `localStorage` persistence
A small hook owns marks state and mirrors it to `localStorage` on every change. The storage key is a parameter (`"pdfjs-marks"` for the current viewer) so a second prototype viewer can have an independent set without colliding.

### 11. `src/prototypes/` directory
The single viewer is nested inside `src/prototypes/PdfJsCanvasViewer/`. The directory exists because this is a *survey* — if a second approach (e.g., a pre-rasterized tileset, or `<embed>`-based viewer) gets prototyped, it lands as a sibling and `App.tsx` switches between them.

## What was kept simple or skipped because it's a POC

- **Page 1 only.** Multi-page nav, page thumbnails, scroll-driven page changes — none of it. `getPage(1)` is hard-coded in `PdfJsCanvasViewer.tsx`.
- **No mark deletion.** "Clear all" exists; deleting a single mark doesn't. No keyboard delete, no per-mark menu.
- **Mark info panel is read-only.** Shows native x/y and the swatch; no rename, no notes, no type field.
- **One mark "type."** A numbered, color-rotated circle. No mark categories, no shapes, no associated metadata.
- **No undo/redo.**
- **No backend.** Marks live in `localStorage`, scoped to the current origin and key. There's no server, no auth, no sync, no concept of "the document this mark belongs to" beyond the implicit one.
- **No tests.** Zero unit, integration, or visual tests.
- **No accessibility.** No focus-visible mark, no keyboard placement, no screen-reader text layer (PDF.js's text layer is not used at all).
- **No mobile / touch.** Pointer events are wired up but pinch zoom, two-finger pan, and the context menu suppression on touch devices are not exercised.
- **No print styles.**
- **No dark/light theme toggle** — the viewer is dark-mode only.
- **No virtualization for large mark lists.** `marks.map(...)` rendered directly in the SVG. Fine for tens, not for thousands.
- **No URL state.** Zoom level, scroll position, selected mark — none of it is in the URL, so reload always lands at scale 1.5, scroll (0,0), nothing selected.

## Assumptions that production would handle differently

- **PDF source is trusted.** No size cap, no MIME validation beyond the `accept` attribute, no sandboxing of the worker beyond what PDF.js itself provides. Production needs at least a max upload size and a server-side check.
- **Single page is the whole blueprint.** Real blueprint sets are multi-sheet PDFs; production would need a sheet picker and per-sheet mark scoping.
- **Marks belong to "the current PDF in the browser tab."** There is no document-id keyed storage; uploading a different PDF inherits the previous PDF's marks. Production needs marks-per-document, server-persisted, with a stable document identity (hash, project ID, or sheet ID).
- **One user.** No collaboration, no last-modified-by, no conflict resolution. Production likely needs CRDT-style or last-writer-wins multi-user editing.
- **`crypto.randomUUID` exists.** A fallback is included but it's not cryptographically random; production should accept this only for transient client-side IDs and re-issue authoritative IDs server-side.
- **`localStorage` is durable enough.** It's not — Safari evicts under pressure, private mode is volatile, and it's per-origin not per-user. Production needs a real persistence boundary.
- **The PDF.js bundled worker version matches `pdfjs-dist`.** Vite resolves `pdfjs-dist/build/pdf.worker.min.js?url` from the same package, so today they match. A production app pinning a CDN worker URL would have to track this explicitly.
- **The viewport fits the page comfortably.** No layout work for mobile/portrait or for blueprints that are extreme aspect ratios. The page is centered by margin only (`.pdfjs-page { margin: 20px; }`).
- **Zoom is bounded statically at 0.5× / 16×.** A real viewer would compute "fit page" / "fit width" / "100% physical" and base bounds on the document, not on hard-coded constants.

## Known shortcuts, hacks, and temporary solutions

These are the items that would block a production lift-and-shift:

- **`PAGE_MARGIN = 20` is duplicated between TS and CSS.** The constant in `PdfJsCanvasViewer.tsx:21` *must* match the `margin` on `.pdfjs-page` in `PdfJsCanvasViewer.css:71`. If either changes, zoom anchoring drifts and tile offsets miscompute. Flagged in a code comment.
- **`SNAPSHOT_MAX_LIFETIME_MS = 4000` is a safety net, not a guarantee.** It only fires if `tr.onIdle` never does (e.g., a render-task error path that bypasses `finish()`). Picked "well above a typical re-tile budget" — production should drive this from real telemetry or eliminate the failure modes that need it.
- **`120ms` zoom debounce is empirical.** No measurement, no per-document tuning, no adaptation to slow CPUs.
- **`DRAG_THRESHOLD = 3` (px)** is a magic number that decides whether a left-click became a drag. Not user-tunable, not DPI-aware.
- **Stale-wrap "second commit while wrap is up" path is a compromise.** If the user keeps zooming while the wrap is already showing, we *keep* the existing wrap (which is fully-rendered old tiles) rather than re-snapshot the live tile-layer (which may be partially rendered). The CSS scale on the wrap updates so it tracks the new visible scale, but the source bitmap is even staler. Documented at `PdfJsCanvasViewer.tsx:191-200`.
- **`currentZoom = 0` as the "uninitialized" sentinel** in `TileRenderer`. Works because real zooms are always > 0, but it's a sentinel value embedded in the cache-key string — not robust if someone ever passes 0 deliberately.
- **`tileRenderer.activeCount` is hand-managed.** Increments before render, decrements in both `then` and `catch`. It's correct as written, but a refactor that adds early returns or extra await points has to be careful not to leak.
- **Whole right-click on the scroll container is suppressed.** `onContextMenu={preventDefault}` runs always, not just during drags, so users can't get a real context menu over the page even when they want one.
- **No render coalescing across the marks SVG.** Every mouse move during a drag re-renders all marks (via `setMarks` in `moveMark`). Fine for the small N this POC is built for; not a strategy at higher counts.
- **Worker URL is bundled at build time.** Switching to a CDN-hosted worker (for caching across sites) would need explicit version pinning that the current `?url` import does not provide.
- **`.vs/` directory is in the repo tree.** Visual Studio's index DBs (`.vs\PDF-viewer\CopilotIndices\...`) are present locally; `.gitignore` should be checked to confirm they're excluded from commits.
- **No CI / no pre-commit hooks.** `npm run lint` exists but is not enforced anywhere.
- **Error UX is a single red pill.** PDF.js can fail in many ways (password, corrupt, network, worker crash) and the viewer surfaces all of them as `e.message` in `.pdfjs-error`. Production needs typed error handling and recovery affordances.
