import { useEffect, useLayoutEffect, useRef, useState } from "react"
import * as pdfjsLib from "pdfjs-dist"
import type { PDFDocumentProxy, PDFPageProxy, RenderTask } from "pdfjs-dist"
import pdfWorkerUrl from "pdfjs-dist/build/pdf.worker.min.js?url"
import { useMarks } from "../../useMarks"
import { MarkInfoPanel } from "../../MarkInfoPanel"
import "./PdfJsCanvasViewer.css"

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl

interface Props {
    pdfUrl: string
}

const MIN_SCALE = 0.5
const MAX_SCALE = 5
const DRAG_THRESHOLD = 3
// Must match the `margin` on `.pdfjs-page` in PdfJsCanvasViewer.css — used in zoom-anchor math.
const PAGE_MARGIN = 20

export function PdfJsCanvasViewer({ pdfUrl }: Props) {
    const canvasRef = useRef<HTMLCanvasElement | null>(null)
    const scrollRef = useRef<HTMLDivElement | null>(null)
    const pageRef = useRef<PDFPageProxy | null>(null)
    const renderTaskRef = useRef<RenderTask | null>(null)

    const [native, setNative] = useState<{ width: number; height: number } | null>(null)
    const [scale, setScale] = useState(1.5)
    const [rendered, setRendered] = useState<{ width: number; height: number } | null>(null)
    const [error, setError] = useState<string | null>(null)

    const { marks, selectedId, addMark, moveMark, selectMark, toggleSelectMark } =
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
            renderTaskRef.current?.cancel()
            renderTaskRef.current = null
            pageRef.current = null
            doc?.destroy()
        }
    }, [pdfUrl])

    // Re-render canvas whenever scale changes
    useEffect(() => {
        const page = pageRef.current
        const canvas = canvasRef.current
        if (!page || !canvas) return

        let cancelled = false
        const viewport = page.getViewport({ scale })
        const ctx = canvas.getContext("2d")
        if (!ctx) return

        canvas.width = Math.floor(viewport.width)
        canvas.height = Math.floor(viewport.height)

        renderTaskRef.current?.cancel()
        const task = page.render({ canvasContext: ctx, viewport })
        renderTaskRef.current = task

        task.promise
            .then(() => {
                if (cancelled) return
                setRendered({ width: canvas.width, height: canvas.height })
            })
            .catch((e: unknown) => {
                const name = (e as { name?: string })?.name
                if (name === "RenderingCancelledException") return
                if (!cancelled) setError((e as Error).message)
            })

        return () => {
            cancelled = true
            task.cancel()
        }
    }, [scale, native])

    // Zoom-anchor: captured on ctrl+wheel; applied after the canvas re-renders at the new scale
    // so the PDF point under the cursor stays put.
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
        if (!anchor || !el || !rendered) return
        const factor = scale / anchor.oldScale
        el.scrollLeft =
            (anchor.cursorX + anchor.scrollLeft - PAGE_MARGIN) * factor + PAGE_MARGIN - anchor.cursorX
        el.scrollTop =
            (anchor.cursorY + anchor.scrollTop - PAGE_MARGIN) * factor + PAGE_MARGIN - anchor.cursorY
        zoomAnchorRef.current = null
    }, [rendered, scale])

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

    const canvasW = rendered?.width ?? 0
    const canvasH = rendered?.height ?? 0
    const scaleX = native && canvasW ? canvasW / native.width : 1
    const scaleY = native && canvasH ? canvasH / native.height : 1

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
                <span className="hint">
                    Left-click = place / select · drag mark = move · right-click drag = pan · ctrl+scroll = zoom
                </span>
            </div>

            <div ref={scrollRef} className="pdfjs-canvas-scroll">
                <div className="pdfjs-page" style={{ width: canvasW, height: canvasH }}>
                    <canvas ref={canvasRef} className="pdfjs-canvas" />
                    {native && rendered && (
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

            {error && <div className="pdfjs-error">Failed to load PDF: {error}</div>}
            {!native && !error && <div className="pdfjs-loading">Loading PDF…</div>}
        </div>
    )
}
