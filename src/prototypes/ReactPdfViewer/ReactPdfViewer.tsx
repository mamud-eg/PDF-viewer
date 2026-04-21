import { useMemo, useState } from "react"
import { Worker, Viewer } from "@react-pdf-viewer/core"
import type { Plugin, PluginRenderPageLayer, DocumentLoadEvent } from "@react-pdf-viewer/core"
import { defaultLayoutPlugin } from "@react-pdf-viewer/default-layout"
import pdfWorkerUrl from "pdfjs-dist/build/pdf.worker.min.js?url"
import type { RegistrationMark } from "../../types"

import "@react-pdf-viewer/core/lib/styles/index.css"
import "@react-pdf-viewer/default-layout/lib/styles/index.css"
import "./ReactPdfViewer.css"

interface Props {
    pdfUrl: string
    marks: RegistrationMark[]
}

export function ReactPdfViewer({ pdfUrl, marks }: Props) {
    const defaultLayout = defaultLayoutPlugin()
    const [native, setNative] = useState<{ width: number; height: number } | null>(null)

    const markPlugin: Plugin = useMemo(
        () => ({
            renderPageLayer: (props: PluginRenderPageLayer) => {
                if (props.pageIndex !== 0 || !native) return <></>
                const { width, height } = props
                return (
                    <svg
                        className="reactpdf-overlay"
                        width={width}
                        height={height}
                        viewBox={`0 0 ${width} ${height}`}
                        style={{
                            position: "absolute",
                            top: 0,
                            left: 0,
                            pointerEvents: "none",
                        }}
                    >
                        {marks.map((mark) => {
                            const screenX = (mark.x / native.width) * width
                            const screenY = (mark.y / native.height) * height
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
                )
            },
        }),
        [marks, native],
    )

    async function handleDocumentLoad(e: DocumentLoadEvent) {
        const page = await e.doc.getPage(1)
        const viewport = page.getViewport({ scale: 1 })
        setNative({ width: viewport.width, height: viewport.height })
    }

    return (
        <div className="reactpdf-wrapper">
            <Worker workerUrl={pdfWorkerUrl}>
                <Viewer
                    fileUrl={pdfUrl}
                    plugins={[defaultLayout, markPlugin]}
                    onDocumentLoad={handleDocumentLoad}
                />
            </Worker>
        </div>
    )
}
