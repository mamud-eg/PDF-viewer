import { useEffect, useRef, useState } from "react"
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
const PAN_THRESHOLD = 5

export function PdfJsCanvasViewer({ pdfUrl }: Props) {
    const canvasRef = useRef<HTMLCanvasElement | null>(null)
    const scrollRef = useRef<HTMLDivElement | null>(null)
    const pageRef = useRef<PDFPageProxy | null>(null)
    const renderTaskRef = useRef<RenderTask | null>(null)

    const [native, setNative] = useState<{ width: number; height: number } | null>(null)
    const [scale, setScale] = useState(1.5)
    const [offset, setOffset] = useState({ x: 0, y: 0 })
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

    // Mouse-wheel zoom — attach natively so we can preventDefault (React's onWheel is passive)
    useEffect(() => {
        const el = scrollRef.current
        if (!el) return

        function onWheel(e: WheelEvent) {
            if (!e.ctrlKey && !e.metaKey && Math.abs(e.deltaY) < 2) return
            e.preventDefault()
            setScale((s) => {
                const factor = e.deltaY < 0 ? 1.1 : 1 / 1.1
                return Math.min(MAX_SCALE, Math.max(MIN_SCALE, s * factor))
            })
        }

        el.addEventListener("wheel", onWheel, { passive: false })
        return () => el.removeEventListener("wheel", onWheel)
    }, [])

    const canvasW = rendered?.width ?? 0
    const canvasH = rendered?.height ?? 0
    const scaleX = native && canvasW ? canvasW / native.width : 1
    const scaleY = native && canvasH ? canvasH / native.height : 1

    // Pan (scroll container) — only when not dragging a mark
    const panRef = useRef<{
        startX: number
        startY: number
        baseX: number
        baseY: number
        moved: boolean
    } | null>(null)

    // Flag read by the SVG onClick to suppress placement after a pan.
    // Cleared at the start of the next pointerdown so it survives the pointerup→click flow.
    const panDidMoveRef = useRef(false)

    // Mark drag state
    const markDragRef = useRef<{
        id: string
        startOffsetX: number
        startOffsetY: number
        moved: boolean
    } | null>(null)
    const [draggingMarkId, setDraggingMarkId] = useState<string | null>(null)

    function handlePointerDown(e: React.PointerEvent<HTMLDivElement>) {
        if (markDragRef.current) return
        // If pointerdown originated on the SVG overlay (empty area or mark),
        // let the SVG/mark handlers own this interaction — don't start a pan.
        const target = e.target as Element | null
        if (target && (target.tagName === "svg" || target.closest(".pdfjs-overlay"))) {
            return
        }
        panDidMoveRef.current = false
        ;(e.currentTarget as HTMLDivElement).setPointerCapture(e.pointerId)
        panRef.current = {
            startX: e.clientX,
            startY: e.clientY,
            baseX: offset.x,
            baseY: offset.y,
            moved: false,
        }
    }
    function handlePointerMove(e: React.PointerEvent<HTMLDivElement>) {
        if (!panRef.current) return
        const dx = e.clientX - panRef.current.startX
        const dy = e.clientY - panRef.current.startY
        if (!panRef.current.moved && dx * dx + dy * dy > PAN_THRESHOLD * PAN_THRESHOLD) {
            panRef.current.moved = true
        }
        setOffset({ x: panRef.current.baseX + dx, y: panRef.current.baseY + dy })
    }
    function handlePointerUp(e: React.PointerEvent<HTMLDivElement>) {
        ;(e.currentTarget as HTMLDivElement).releasePointerCapture(e.pointerId)
        if (panRef.current?.moved) {
            panDidMoveRef.current = true
        }
        panRef.current = null
    }

    function nativeFromSvgEvent(e: React.PointerEvent<SVGElement> | React.MouseEvent<SVGElement>) {
        const svg = e.currentTarget.ownerSVGElement ?? (e.currentTarget as SVGSVGElement)
        const rect = svg.getBoundingClientRect()
        const ox = e.clientX - rect.left
        const oy = e.clientY - rect.top
        return { nativeX: ox / scaleX, nativeY: oy / scaleY, offsetX: ox, offsetY: oy }
    }

    function handleMarkPointerDown(e: React.PointerEvent<SVGGElement>, id: string) {
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

    function handleSvgPointerUp(e: React.PointerEvent<SVGSVGElement>) {
        // Suppress if this is the tail of a pan or mark drag
        if (panDidMoveRef.current) return
        // If a mark drag just finished, markDragRef was cleared in handleMarkPointerUp
        // but we need another ref to track if *any* mark was dragged this interaction
        const didDragMark = draggingMarkId !== null
        // If something is selected, first click on empty area just deselects
        if (selectedId !== null) {
            selectMark(null)
            return
        }
        // Only place if we didn't just drag a mark
        if (!didDragMark) {
            const { nativeX, nativeY } = nativeFromSvgEvent(e)
            addMark(nativeX, nativeY)
        }
    }

    function handleSvgClick(e: React.MouseEvent<SVGSVGElement>) {
        // Fallback for browsers/scenarios where click fires despite mark drag.
        // Mark <g> elements have onClick stopPropagation so this only fires on empty area.
        if (panDidMoveRef.current) return
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
                <button
                    onClick={() => {
                        setScale(1.5)
                        setOffset({ x: 0, y: 0 })
                    }}
                >
                    Reset
                </button>
                <span className="hint">Click = place · drag mark = move · click mark = select · scroll = zoom</span>
            </div>

            <div
                ref={scrollRef}
                className="pdfjs-canvas-scroll"
                onPointerDown={handlePointerDown}
                onPointerMove={handlePointerMove}
                onPointerUp={handlePointerUp}
                onPointerCancel={handlePointerUp}
            >
                <div
                    className="pdfjs-stage"
                    style={{ transform: `translate(${offset.x}px, ${offset.y}px)` }}
                >
                    <div className="pdfjs-page" style={{ width: canvasW, height: canvasH }}>
                        <canvas ref={canvasRef} className="pdfjs-canvas" />
                        {native && rendered && (
                            <svg
                                className="pdfjs-overlay"
                                width={canvasW}
                                height={canvasH}
                                viewBox={`0 0 ${canvasW} ${canvasH}`}
                                onPointerUp={handleSvgPointerUp}
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
            </div>

            {error && <div className="pdfjs-error">Failed to load PDF: {error}</div>}
            {!native && !error && <div className="pdfjs-loading">Loading PDF…</div>}
        </div>
    )
}
