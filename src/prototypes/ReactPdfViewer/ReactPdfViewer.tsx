import { useEffect, useMemo, useRef, useState } from "react"
import { Worker, Viewer } from "@react-pdf-viewer/core"
import type { Plugin, PluginRenderPageLayer } from "@react-pdf-viewer/core"
import { defaultLayoutPlugin } from "@react-pdf-viewer/default-layout"
import pdfWorkerUrl from "pdfjs-dist/build/pdf.worker.min.js?url"
import type { RegistrationMark } from "../../types"
import { useMarks } from "../../useMarks"
import { MarkInfoPanel } from "../../MarkInfoPanel"

import "@react-pdf-viewer/core/lib/styles/index.css"
import "@react-pdf-viewer/default-layout/lib/styles/index.css"
import "./ReactPdfViewer.css"

interface Props {
    pdfUrl: string
}

const DRAG_THRESHOLD = 3
const MIN_SCALE = 0.25
const MAX_SCALE = 16

interface MarkLayerProps {
    width: number
    height: number
    scale: number
    marks: RegistrationMark[]
    selectedId: string | null
    addMark: (x: number, y: number) => void
    moveMark: (id: string, x: number, y: number) => void
    selectMark: (id: string | null) => void
    toggleSelectMark: (id: string) => void
}

function MarkLayer({
    width,
    height,
    scale,
    marks,
    selectedId,
    addMark,
    moveMark,
    selectMark,
    toggleSelectMark,
}: MarkLayerProps) {
    const markDragRef = useRef<{
        id: string
        startX: number
        startY: number
        moved: boolean
    } | null>(null)
    const [draggingMarkId, setDraggingMarkId] = useState<string | null>(null)

    // Use the plugin-provided `scale` directly so SVG marks track the rendered
    // page exactly at every zoom level — width/height ratio could drift due to
    // rounding in the library's intermediate layout.
    const scaleX = scale
    const scaleY = scale

    function nativeFromEvent(e: React.PointerEvent<SVGElement> | React.MouseEvent<SVGElement>) {
        const svg = e.currentTarget.ownerSVGElement ?? (e.currentTarget as SVGSVGElement)
        const rect = svg.getBoundingClientRect()
        const ox = e.clientX - rect.left
        const oy = e.clientY - rect.top
        return {
            offsetX: ox,
            offsetY: oy,
            nativeX: ox / scale,
            nativeY: oy / scale,
        }
    }

    function handleMarkPointerDown(e: React.PointerEvent<SVGGElement>, id: string) {
        if (e.button !== 0) return
        e.stopPropagation()
        const target = e.currentTarget
        target.setPointerCapture(e.pointerId)
        const { offsetX, offsetY } = nativeFromEvent(e)
        markDragRef.current = { id, startX: offsetX, startY: offsetY, moved: false }
        setDraggingMarkId(id)
    }
    function handleMarkPointerMove(e: React.PointerEvent<SVGGElement>) {
        const drag = markDragRef.current
        if (!drag) return
        const { offsetX, offsetY, nativeX, nativeY } = nativeFromEvent(e)
        if (!drag.moved) {
            const dx = offsetX - drag.startX
            const dy = offsetY - drag.startY
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
            // ignore
        }
        const drag = markDragRef.current
        markDragRef.current = null
        setDraggingMarkId(null)
        if (drag && !drag.moved) {
            toggleSelectMark(drag.id)
        }
    }

    function handleSvgPointerUp(e: React.PointerEvent<SVGSVGElement>) {
        if (e.button !== 0) return
        const didDragMark = draggingMarkId !== null
        if (selectedId !== null) {
            selectMark(null)
            return
        }
        if (!didDragMark) {
            const { nativeX, nativeY } = nativeFromEvent(e)
            addMark(nativeX, nativeY)
        }
    }

    function handleSvgClick(e: React.MouseEvent<SVGSVGElement>) {
        if (e.button !== 0) return
        const didDragMark = draggingMarkId !== null
        if (selectedId !== null) {
            selectMark(null)
            return
        }
        if (!didDragMark) {
            const { nativeX, nativeY } = nativeFromEvent(e)
            addMark(nativeX, nativeY)
        }
    }

    const selectedMark = selectedId ? marks.find((m) => m.id === selectedId) ?? null : null

    return (
        <div
            style={{
                position: "absolute",
                top: 0,
                left: 0,
                width,
                height,
                pointerEvents: "all",
                zIndex: 2,
            }}
        >
            <svg
                className="reactpdf-overlay"
                width={width}
                height={height}
                viewBox={`0 0 ${width} ${height}`}
                style={{ position: "absolute", top: 0, left: 0 }}
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
                            className={`reactpdf-mark${isDragging ? " dragging" : ""}`}
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
            {selectedMark && (
                <MarkInfoPanel
                    mark={selectedMark}
                    screenX={selectedMark.x * scaleX}
                    screenY={selectedMark.y * scaleY}
                    onClose={() => selectMark(null)}
                />
            )}
        </div>
    )
}

export function ReactPdfViewer({ pdfUrl }: Props) {
    const defaultLayout = useMemo(() => defaultLayoutPlugin(), [])
    const wrapperRef = useRef<HTMLDivElement | null>(null)
    const { marks, selectedId, addMark, moveMark, selectMark, toggleSelectMark } =
        useMarks("reactpdf-marks")

    // Tracked via Viewer's onZoom callback so cursor-anchored zoom knows the
    // scale before each wheel event. Initialised to match `defaultScale={1}`.
    const currentScaleRef = useRef(1)
    // Anchor data captured on Ctrl+wheel and consumed inside onZoom (after one
    // rAF, to let the library finish relayouting pages at the new scale).
    const pendingAnchorRef = useRef<{
        oldScale: number
        newScale: number
        cursorX: number
        cursorY: number
        scrollLeft: number
        scrollTop: number
        scrollEl: HTMLElement
    } | null>(null)

    // Right-click drag = pan. The library renders its own scroll container
    // (`.rpv-core__inner-pages`); we adjust its scrollLeft/scrollTop directly.
    useEffect(() => {
        const wrapper = wrapperRef.current
        if (!wrapper) return

        let pan: {
            container: HTMLElement
            startX: number
            startY: number
            scrollLeft: number
            scrollTop: number
        } | null = null

        function onMouseDown(e: MouseEvent) {
            if (e.button !== 2) return
            const container = wrapper!.querySelector<HTMLElement>(".rpv-core__inner-pages")
            if (!container) return
            e.preventDefault()
            pan = {
                container,
                startX: e.clientX,
                startY: e.clientY,
                scrollLeft: container.scrollLeft,
                scrollTop: container.scrollTop,
            }
            wrapper!.classList.add("panning")
        }
        function onMouseMove(e: MouseEvent) {
            if (!pan) return
            e.preventDefault()
            pan.container.scrollLeft = pan.scrollLeft - (e.clientX - pan.startX)
            pan.container.scrollTop = pan.scrollTop - (e.clientY - pan.startY)
        }
        function onMouseUp(e: MouseEvent) {
            if (!pan || e.button !== 2) return
            pan = null
            wrapper!.classList.remove("panning")
        }
        function onContextMenu(e: MouseEvent) {
            e.preventDefault()
        }

        wrapper.addEventListener("mousedown", onMouseDown)
        wrapper.addEventListener("contextmenu", onContextMenu)
        window.addEventListener("mousemove", onMouseMove)
        window.addEventListener("mouseup", onMouseUp)
        return () => {
            wrapper.removeEventListener("mousedown", onMouseDown)
            wrapper.removeEventListener("contextmenu", onContextMenu)
            window.removeEventListener("mousemove", onMouseMove)
            window.removeEventListener("mouseup", onMouseUp)
        }
    }, [])

    // Ctrl/Cmd + wheel = cursor-anchored zoom. Plain wheel = library-native scroll.
    // The library renders its own scroll container (`.rpv-core__inner-pages`);
    // we call zoomTo() on its zoom plugin and adjust scrollLeft/scrollTop in
    // onZoom once the new layout has been committed.
    useEffect(() => {
        const wrapper = wrapperRef.current
        if (!wrapper) return

        function onWheel(e: WheelEvent) {
            if (!e.ctrlKey && !e.metaKey) return
            const scrollEl = wrapper!.querySelector<HTMLElement>(".rpv-core__inner-pages")
            if (!scrollEl) return
            e.preventDefault()
            const rect = scrollEl.getBoundingClientRect()
            const cursorX = e.clientX - rect.left
            const cursorY = e.clientY - rect.top
            const oldScale = currentScaleRef.current
            const factor = e.deltaY < 0 ? 1.1 : 1 / 1.1
            const newScale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, oldScale * factor))
            if (newScale === oldScale) return
            pendingAnchorRef.current = {
                oldScale,
                newScale,
                cursorX,
                cursorY,
                scrollLeft: scrollEl.scrollLeft,
                scrollTop: scrollEl.scrollTop,
                scrollEl,
            }
            defaultLayout.toolbarPluginInstance.zoomPluginInstance.zoomTo(newScale)
        }

        wrapper.addEventListener("wheel", onWheel, { passive: false })
        return () => wrapper.removeEventListener("wheel", onWheel)
    }, [defaultLayout])

    function handleZoom(e: { scale: number }) {
        currentScaleRef.current = e.scale
        const a = pendingAnchorRef.current
        if (!a) return
        // Ignore stale callbacks from toolbar / fit-to-page zooms — only fix
        // the scroll position if this onZoom corresponds to our pending wheel.
        if (Math.abs(e.scale - a.newScale) > 1e-3) return
        pendingAnchorRef.current = null
        requestAnimationFrame(() => {
            const factor = e.scale / a.oldScale
            a.scrollEl.scrollLeft = (a.cursorX + a.scrollLeft) * factor - a.cursorX
            a.scrollEl.scrollTop = (a.cursorY + a.scrollTop) * factor - a.cursorY
        })
    }

    const markPlugin: Plugin = useMemo(
        () => ({
            renderPageLayer: (props: PluginRenderPageLayer) => {
                if (props.pageIndex !== 0) return <></>
                return (
                    <MarkLayer
                        width={props.width}
                        height={props.height}
                        scale={props.scale}
                        marks={marks}
                        selectedId={selectedId}
                        addMark={addMark}
                        moveMark={moveMark}
                        selectMark={selectMark}
                        toggleSelectMark={toggleSelectMark}
                    />
                )
            },
        }),
        [marks, selectedId, addMark, moveMark, selectMark, toggleSelectMark],
    )

    return (
        <div ref={wrapperRef} className="reactpdf-wrapper">
            <Worker workerUrl={pdfWorkerUrl}>
                <Viewer
                    fileUrl={pdfUrl}
                    plugins={[defaultLayout, markPlugin]}
                    defaultScale={1}
                    onZoom={handleZoom}
                />
            </Worker>
        </div>
    )
}
