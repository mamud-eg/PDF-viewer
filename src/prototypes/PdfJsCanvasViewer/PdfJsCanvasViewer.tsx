import { useEffect, useRef, useState } from "react"
import * as pdfjsLib from "pdfjs-dist"
import type { PDFDocumentProxy, PDFPageProxy, RenderTask } from "pdfjs-dist"
import pdfWorkerUrl from "pdfjs-dist/build/pdf.worker.min.js?url"
import type { RegistrationMark } from "../../types"
import "./PdfJsCanvasViewer.css"

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl

interface Props {
    pdfUrl: string
    marks: RegistrationMark[]
}

const MIN_SCALE = 0.5
const MAX_SCALE = 5

export function PdfJsCanvasViewer({ pdfUrl, marks }: Props) {
    const canvasRef = useRef<HTMLCanvasElement | null>(null)
    const scrollRef = useRef<HTMLDivElement | null>(null)
    const pageRef = useRef<PDFPageProxy | null>(null)
    const renderTaskRef = useRef<RenderTask | null>(null)

    const [native, setNative] = useState<{ width: number; height: number } | null>(null)
    const [scale, setScale] = useState(1.5)
    const [offset, setOffset] = useState({ x: 0, y: 0 })
    const [rendered, setRendered] = useState<{ width: number; height: number } | null>(null)
    const [error, setError] = useState<string | null>(null)

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

    // Drag-to-pan
    const dragRef = useRef<{ startX: number; startY: number; baseX: number; baseY: number } | null>(null)

    function handlePointerDown(e: React.PointerEvent<HTMLDivElement>) {
        ;(e.currentTarget as HTMLDivElement).setPointerCapture(e.pointerId)
        dragRef.current = { startX: e.clientX, startY: e.clientY, baseX: offset.x, baseY: offset.y }
    }
    function handlePointerMove(e: React.PointerEvent<HTMLDivElement>) {
        if (!dragRef.current) return
        setOffset({
            x: dragRef.current.baseX + (e.clientX - dragRef.current.startX),
            y: dragRef.current.baseY + (e.clientY - dragRef.current.startY),
        })
    }
    function handlePointerUp(e: React.PointerEvent<HTMLDivElement>) {
        ;(e.currentTarget as HTMLDivElement).releasePointerCapture(e.pointerId)
        dragRef.current = null
    }

    const canvasW = rendered?.width ?? 0
    const canvasH = rendered?.height ?? 0
    const scaleX = native && canvasW ? canvasW / native.width : 1
    const scaleY = native && canvasH ? canvasH / native.height : 1

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
                <span className="hint">Scroll = zoom · drag = pan</span>
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
                            >
                                {marks.map((mark) => {
                                    const screenX = mark.x * scaleX
                                    const screenY = mark.y * scaleY
                                    return (
                                        <g key={mark.id}>
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
                    </div>
                </div>
            </div>

            {error && <div className="pdfjs-error">Failed to load PDF: {error}</div>}
            {!native && !error && <div className="pdfjs-loading">Loading PDF…</div>}
        </div>
    )
}
