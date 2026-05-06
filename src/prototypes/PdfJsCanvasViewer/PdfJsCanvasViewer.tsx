import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react"
import * as pdfjsLib from "pdfjs-dist"
import type { PDFDocumentProxy, PDFPageProxy } from "pdfjs-dist"
import pdfWorkerUrl from "pdfjs-dist/build/pdf.worker.min.js?url"
import { useMarks } from "../../useMarks"
import { MarkInfoPanel } from "../../MarkInfoPanel"
import { TileRenderer } from "./tileRenderer"
import "./PdfJsCanvasViewer.css"

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl

interface Props {
    pdfUrl: string
}

const MIN_SCALE = 0.5
const MAX_SCALE = 16
const DRAG_THRESHOLD = 3
// Must match the `margin` on `.pdfjs-page` in PdfJsCanvasViewer.css — used in zoom-anchor math
// and in the page-relative scroll offset passed to the tile renderer.
const PAGE_MARGIN = 20
// Safety net: drop the wrap if the renderer never reports idle (e.g., render error path).
// Picked well above a typical re-tile budget so it never fights the real signal.
const SNAPSHOT_MAX_LIFETIME_MS = 4000

export function PdfJsCanvasViewer({ pdfUrl }: Props) {
    const tileLayerRef = useRef<HTMLDivElement | null>(null)
    const scrollRef = useRef<HTMLDivElement | null>(null)
    const pageRef = useRef<PDFPageProxy | null>(null)
    const tileRendererRef = useRef<TileRenderer | null>(null)

    const [native, setNative] = useState<{ width: number; height: number } | null>(null)
    const [scale, setScale] = useState(1.5)
    // The zoom level the rendered tiles are pinned to. Lags behind `scale` during rapid zoom:
    // we CSS-scale the existing tiles in the meantime and only re-tile after the user pauses.
    // This keeps PDF.js from being asked to render new tiles on every wheel tick.
    const [committedScale, setCommittedScale] = useState(1.5)
    const [error, setError] = useState<string | null>(null)
    // Drives the centered "Rendering…" pill. True while the stale wrap is up (i.e., while the
    // CSS-upscaled snapshot is bridging the gap until fresh tiles finish).
    const [transitioning, setTransitioning] = useState(false)
    // Stale-wrap state: holds the previously-drawn tile canvases (re-parented out of the live
    // tile-layer) while fresh tiles render off-DOM into the new tile-layer. Wrap is sized to
    // the OLD committed scale and CSS-scaled to the current visible scale, so the user sees
    // the page upscaled instead of white during the render. Removed on tr.onIdle.
    const staleWrapRef = useRef<HTMLDivElement | null>(null)
    const staleScaleRef = useRef(0)
    const prevCommittedRef = useRef(1.5)
    const safetyTimerRef = useRef<number | null>(null)

    const { marks, selectedId, addMark, moveMark, selectMark, toggleSelectMark, clearMarks } =
        useMarks("pdfjs-marks")

    // Load PDF once
    useEffect(() => {
        let cancelled = false
        let doc: PDFDocumentProxy | null = null

        ;(async () => {
            try {
                const loadingTask = pdfjsLib.getDocument(pdfUrl)
                doc = await loadingTask.promise
                if (cancelled) {
                    doc.destroy()
                    return
                }
                const page = await doc.getPage(1)
                if (cancelled) {
                    doc.destroy()
                    return
                }
                pageRef.current = page
                const viewport = page.getViewport({ scale: 1 })
                setNative({ width: viewport.width, height: viewport.height })
            } catch (e) {
                if (!cancelled) setError((e as Error).message)
            }
        })()

        return () => {
            cancelled = true
            pageRef.current = null
            doc?.destroy()
        }
    }, [pdfUrl])

    // Init tile renderer once the tile-layer element exists.
    useEffect(() => {
        const layer = tileLayerRef.current
        if (!layer) return
        const tr = new TileRenderer(layer)
        tileRendererRef.current = tr
        return () => {
            tr.destroy()
            if (tileRendererRef.current === tr) tileRendererRef.current = null
        }
    }, [])

    const canvasW = native ? Math.floor(native.width * scale) : 0
    const canvasH = native ? Math.floor(native.height * scale) : 0
    const tileW = native ? Math.floor(native.width * committedScale) : 0
    const tileH = native ? Math.floor(native.height * committedScale) : 0
    const scaleX = native && canvasW ? canvasW / native.width : 1
    const scaleY = native && canvasH ? canvasH / native.height : 1

    const updateTiles = useCallback(() => {
        const tr = tileRendererRef.current
        const scroll = scrollRef.current
        if (!tr || !scroll || !native) return
        // While the visible scale doesn't match the committed scale we're CSS-scaling existing
        // tiles; don't compute a new visible range against mismatched coordinate spaces.
        if (scale !== committedScale) return
        tr.update({
            scrollLeft: scroll.scrollLeft,
            scrollTop: scroll.scrollTop,
            viewportWidth: scroll.clientWidth,
            viewportHeight: scroll.clientHeight,
            pageWidth: tileW,
            pageHeight: tileH,
            offsetX: PAGE_MARGIN,
            offsetY: PAGE_MARGIN,
        })
    }, [native, scale, committedScale, tileW, tileH])

    // Zoom-anchor: captured on ctrl+wheel; applied after the page wrapper resizes at the new scale
    // so the PDF point under the cursor stays put. This must run before the tile-update effect so
    // the tile range is computed against the post-anchor scroll position.
    const zoomAnchorRef = useRef<{
        oldScale: number
        cursorX: number
        cursorY: number
        scrollLeft: number
        scrollTop: number
    } | null>(null)

    useLayoutEffect(() => {
        const anchor = zoomAnchorRef.current
        const el = scrollRef.current
        if (!anchor || !el || !native) return
        const factor = scale / anchor.oldScale
        el.scrollLeft =
            (anchor.cursorX + anchor.scrollLeft - PAGE_MARGIN) * factor + PAGE_MARGIN - anchor.cursorX
        el.scrollTop =
            (anchor.cursorY + anchor.scrollTop - PAGE_MARGIN) * factor + PAGE_MARGIN - anchor.cursorY
        zoomAnchorRef.current = null
    }, [scale, native])

    // Debounce: bump committedScale once `scale` has stopped changing for a beat.
    // Each new scale resets the timer so the user can keep zooming without paying re-tile cost.
    useEffect(() => {
        if (scale === committedScale) return
        const id = window.setTimeout(() => setCommittedScale(scale), 120)
        return () => clearTimeout(id)
    }, [scale, committedScale])

    // Tear-down: pulls the stale wrap out of the DOM (releasing the re-parented canvases with
    // it), clears refs and timer. Idempotent.
    const tearDownStaleWrap = useCallback(() => {
        const wrap = staleWrapRef.current
        if (wrap) {
            wrap.remove()
            staleWrapRef.current = null
        }
        staleScaleRef.current = 0
        if (safetyTimerRef.current !== null) {
            clearTimeout(safetyTimerRef.current)
            safetyTimerRef.current = null
        }
        setTransitioning(false)
    }, [])

    // On committedScale or page change: bind page, set new zoom, render tiles. useLayoutEffect
    // so the snapshot/clear/queue all happen in the same frame.
    //
    // To avoid the white flash mid-zoom we re-parent the existing (drawn) tile canvases into
    // a stale wrap *before* asking the renderer to forget them. Combined with the renderer's
    // atomic-swap (tiles only attach when fully drawn), the wrap is guaranteed to hold real
    // bitmaps, never blanks. The wrap stays visible CSS-scaled to the current visible scale
    // while fresh tiles render off-DOM. The renderer's onIdle callback drops the wrap the
    // instant the new render is done.
    useLayoutEffect(() => {
        const tr = tileRendererRef.current
        const page = pageRef.current
        const tileLayer = tileLayerRef.current
        if (!tr || !page || !native || !tileLayer) return

        const oldCommitted = prevCommittedRef.current
        prevCommittedRef.current = committedScale

        if (oldCommitted !== committedScale && oldCommitted > 0) {
            if (staleWrapRef.current) {
                // A wrap from a prior commit is already up. Its tiles are fully rendered;
                // replacing it with whatever is in tile-layer right now (which may be a partial
                // mid-render set) would look worse. Keep it; setZoom below discards in-flight
                // and partial tiles for the previous commit. Just push the safety timer.
                if (safetyTimerRef.current !== null) clearTimeout(safetyTimerRef.current)
                safetyTimerRef.current = window.setTimeout(
                    tearDownStaleWrap,
                    SNAPSHOT_MAX_LIFETIME_MS,
                )
            } else {
                const liveTiles = tileLayer.querySelectorAll<HTMLCanvasElement>(
                    "canvas.pdfjs-tile",
                )
                const pageWrap = tileLayer.parentElement
                if (liveTiles.length > 0 && pageWrap) {
                    const wrap = document.createElement("div")
                    wrap.className = "pdfjs-stale-wrap"
                    wrap.style.width = `${Math.floor(native.width * oldCommitted)}px`
                    wrap.style.height = `${Math.floor(native.height * oldCommitted)}px`
                    wrap.style.transform = `scale(${scale / oldCommitted})`

                    // Cheap: re-parent existing canvases. No drawImage, no new bitmaps.
                    for (const tile of Array.from(liveTiles)) {
                        wrap.appendChild(tile)
                    }

                    // Behind the live tile-layer (z-index in CSS). Inserted before tile-layer
                    // so fresh tiles paint over the wrap as they finish rendering.
                    pageWrap.insertBefore(wrap, tileLayer)
                    staleWrapRef.current = wrap
                    staleScaleRef.current = oldCommitted
                    setTransitioning(true)

                    safetyTimerRef.current = window.setTimeout(
                        tearDownStaleWrap,
                        SNAPSHOT_MAX_LIFETIME_MS,
                    )

                    // Cache still references the re-parented canvases. Wipe it (cancels any
                    // in-flight tasks) without removing the canvases from DOM.
                    tr.detachCurrentTiles()
                }
            }
        }

        tr.setOnIdle(tearDownStaleWrap)
        tr.setPage(page)
        tr.setZoom(committedScale)
        updateTiles()

        // Edge case: nothing new to render — fire teardown now instead of waiting on an
        // onIdle that won't come.
        if (tr.isIdle() && staleWrapRef.current) {
            tearDownStaleWrap()
        }
    }, [committedScale, native, updateTiles, tearDownStaleWrap, scale])

    // Track scale changes on the live wrap directly (avoids React re-rendering the wrap node
    // on every wheel tick during further zooming).
    useLayoutEffect(() => {
        const wrap = staleWrapRef.current
        const oldScale = staleScaleRef.current
        if (!wrap || oldScale === 0) return
        wrap.style.transform = `scale(${scale / oldScale})`
    }, [scale])

    useEffect(() => {
        return () => {
            if (safetyTimerRef.current !== null) clearTimeout(safetyTimerRef.current)
            tileRendererRef.current?.setOnIdle(null)
        }
    }, [])

    // Render new tiles as the user scrolls (cached tiles within the current zoom are reused).
    useEffect(() => {
        const scroll = scrollRef.current
        if (!scroll) return
        const onScroll = () => updateTiles()
        scroll.addEventListener("scroll", onScroll, { passive: true })
        return () => scroll.removeEventListener("scroll", onScroll)
    }, [updateTiles])

    // Ctrl/Cmd + wheel = zoom (anchored at cursor). Plain wheel = browser-native scroll.
    useEffect(() => {
        const el = scrollRef.current
        if (!el) return

        function onWheel(e: WheelEvent) {
            if (!e.ctrlKey && !e.metaKey) return
            e.preventDefault()
            const rect = el!.getBoundingClientRect()
            const cursorX = e.clientX - rect.left
            const cursorY = e.clientY - rect.top
            setScale((s) => {
                const factor = e.deltaY < 0 ? 1.1 : 1 / 1.1
                const newScale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, s * factor))
                if (newScale === s) return s
                zoomAnchorRef.current = {
                    oldScale: s,
                    cursorX,
                    cursorY,
                    scrollLeft: el!.scrollLeft,
                    scrollTop: el!.scrollTop,
                }
                return newScale
            })
        }

        el.addEventListener("wheel", onWheel, { passive: false })
        return () => el.removeEventListener("wheel", onWheel)
    }, [])

    // Right-click drag = pan (adjusts the real scroll container, so scrollbars stay in sync).
    useEffect(() => {
        const el = scrollRef.current
        if (!el) return

        let pan: { startX: number; startY: number; scrollLeft: number; scrollTop: number } | null = null

        function onMouseDown(e: MouseEvent) {
            if (e.button !== 2) return
            e.preventDefault()
            pan = {
                startX: e.clientX,
                startY: e.clientY,
                scrollLeft: el!.scrollLeft,
                scrollTop: el!.scrollTop,
            }
            el!.classList.add("panning")
        }
        function onMouseMove(e: MouseEvent) {
            if (!pan) return
            e.preventDefault()
            el!.scrollLeft = pan.scrollLeft - (e.clientX - pan.startX)
            el!.scrollTop = pan.scrollTop - (e.clientY - pan.startY)
        }
        function onMouseUp(e: MouseEvent) {
            if (!pan || e.button !== 2) return
            pan = null
            el!.classList.remove("panning")
        }
        function onContextMenu(e: MouseEvent) {
            e.preventDefault()
        }

        el.addEventListener("mousedown", onMouseDown)
        el.addEventListener("contextmenu", onContextMenu)
        window.addEventListener("mousemove", onMouseMove)
        window.addEventListener("mouseup", onMouseUp)
        return () => {
            el.removeEventListener("mousedown", onMouseDown)
            el.removeEventListener("contextmenu", onContextMenu)
            window.removeEventListener("mousemove", onMouseMove)
            window.removeEventListener("mouseup", onMouseUp)
        }
    }, [])

    // Mark drag state (left-click only; right-click is reserved for panning)
    const markDragRef = useRef<{
        id: string
        startOffsetX: number
        startOffsetY: number
        moved: boolean
    } | null>(null)
    const [draggingMarkId, setDraggingMarkId] = useState<string | null>(null)

    function nativeFromSvgEvent(e: React.PointerEvent<SVGElement> | React.MouseEvent<SVGElement>) {
        const svg = e.currentTarget.ownerSVGElement ?? (e.currentTarget as SVGSVGElement)
        const rect = svg.getBoundingClientRect()
        const ox = e.clientX - rect.left
        const oy = e.clientY - rect.top
        return { nativeX: ox / scaleX, nativeY: oy / scaleY, offsetX: ox, offsetY: oy }
    }

    function handleMarkPointerDown(e: React.PointerEvent<SVGGElement>, id: string) {
        if (e.button !== 0) return
        e.stopPropagation()
        const target = e.currentTarget
        target.setPointerCapture(e.pointerId)
        const { offsetX, offsetY } = nativeFromSvgEvent(e)
        markDragRef.current = { id, startOffsetX: offsetX, startOffsetY: offsetY, moved: false }
        setDraggingMarkId(id)
    }
    function handleMarkPointerMove(e: React.PointerEvent<SVGGElement>) {
        const drag = markDragRef.current
        if (!drag) return
        const { offsetX, offsetY, nativeX, nativeY } = nativeFromSvgEvent(e)
        if (!drag.moved) {
            const dx = offsetX - drag.startOffsetX
            const dy = offsetY - drag.startOffsetY
            if (dx * dx + dy * dy > DRAG_THRESHOLD * DRAG_THRESHOLD) {
                drag.moved = true
            }
        }
        if (drag.moved) {
            moveMark(drag.id, nativeX, nativeY)
        }
    }
    function handleMarkPointerUp(e: React.PointerEvent<SVGGElement>) {
        e.stopPropagation()
        const target = e.currentTarget
        try {
            target.releasePointerCapture(e.pointerId)
        } catch {
            // ignore: capture may have been released already
        }
        const drag = markDragRef.current
        markDragRef.current = null
        setDraggingMarkId(null)
        if (drag && !drag.moved) {
            toggleSelectMark(drag.id)
        }
    }

    function handleSvgClick(e: React.MouseEvent<SVGSVGElement>) {
        // Left-click only: right-click is handled by the pan logic on the scroll container.
        if (e.button !== 0) return
        const didDragMark = draggingMarkId !== null
        if (selectedId !== null) {
            selectMark(null)
            return
        }
        if (!didDragMark) {
            const { nativeX, nativeY } = nativeFromSvgEvent(e)
            addMark(nativeX, nativeY)
        }
    }

    const selectedMark = selectedId ? marks.find((m) => m.id === selectedId) ?? null : null

    return (
        <div className="pdfjs-wrapper">
            <div className="pdfjs-toolbar">
                <button onClick={() => setScale((s) => Math.max(MIN_SCALE, s / 1.25))}>−</button>
                <span>{Math.round(scale * 100)}%</span>
                <button onClick={() => setScale((s) => Math.min(MAX_SCALE, s * 1.25))}>+</button>
                <button onClick={() => setScale(1.5)}>Reset</button>
                <button className="pdfjs-btn-danger" onClick={clearMarks} disabled={marks.length === 0}>Clear all</button>
                <span className="hint">
                    Left-click = place / select · drag mark = move · right-click drag = pan · ctrl+scroll = zoom
                </span>
            </div>

            <div ref={scrollRef} className="pdfjs-canvas-scroll">
                <div className="pdfjs-page" style={{ width: canvasW, height: canvasH }}>
                    <div
                        ref={tileLayerRef}
                        className="pdfjs-tile-layer"
                        style={{
                            width: tileW,
                            height: tileH,
                            transform:
                                scale === committedScale
                                    ? undefined
                                    : `scale(${scale / committedScale})`,
                            transformOrigin: "0 0",
                        }}
                    />
                    {native && (
                        <svg
                            className="pdfjs-overlay"
                            width={canvasW}
                            height={canvasH}
                            viewBox={`0 0 ${canvasW} ${canvasH}`}
                            onClick={handleSvgClick}
                        >
                            {marks.map((mark) => {
                                const screenX = mark.x * scaleX
                                const screenY = mark.y * scaleY
                                const isSelected = mark.id === selectedId
                                const dim = selectedId !== null && !isSelected
                                const isDragging = draggingMarkId === mark.id
                                return (
                                    <g
                                        key={mark.id}
                                        className={`pdfjs-mark${isDragging ? " dragging" : ""}`}
                                        opacity={dim ? 0.35 : 1}
                                        onPointerDown={(e) => handleMarkPointerDown(e, mark.id)}
                                        onPointerMove={handleMarkPointerMove}
                                        onPointerUp={handleMarkPointerUp}
                                        onPointerCancel={handleMarkPointerUp}
                                        onClick={(e) => e.stopPropagation()}
                                    >
                                        {isSelected && (
                                            <circle
                                                cx={screenX}
                                                cy={screenY}
                                                r={12}
                                                fill="none"
                                                stroke="white"
                                                strokeWidth={3}
                                            />
                                        )}
                                        <circle
                                            cx={screenX}
                                            cy={screenY}
                                            r={8}
                                            fill={mark.color}
                                            stroke="#111"
                                            strokeWidth={1}
                                        />
                                        <text
                                            x={screenX + 12}
                                            y={screenY + 5}
                                            fontSize={14}
                                            fill="black"
                                            stroke="white"
                                            strokeWidth={3}
                                            paintOrder="stroke"
                                        >
                                            {mark.label}
                                        </text>
                                    </g>
                                )
                            })}
                        </svg>
                    )}
                    {selectedMark && (
                        <MarkInfoPanel
                            mark={selectedMark}
                            screenX={selectedMark.x * scaleX}
                            screenY={selectedMark.y * scaleY}
                            onClose={() => selectMark(null)}
                        />
                    )}
                </div>
            </div>

            {transitioning && (
                <div className="pdfjs-render-status" role="status" aria-live="polite">
                    <div className="pdfjs-render-spinner" />
                    <span>Rendering…</span>
                </div>
            )}
            {error && <div className="pdfjs-error">Failed to load PDF: {error}</div>}
            {!native && !error && <div className="pdfjs-loading">Loading PDF…</div>}
        </div>
    )
}
