import { useState } from "react"
import { PdfJsCanvasViewer } from "./prototypes/PdfJsCanvasViewer/PdfJsCanvasViewer"
import { ReactPdfViewer } from "./prototypes/ReactPdfViewer/ReactPdfViewer"
import "./App.css"

const PDF_URL = "/sample.pdf"

type Tab = "pdfjs" | "reactpdf"

export default function App() {
    const [activeTab, setActiveTab] = useState<Tab>("pdfjs")

    return (
        <div className="app">
            <h1>Blueprint Viewer POC</h1>
            <p>AJB-14024 — Technology survey: PDF rendering with registration mark overlay</p>

            <div className="tabs">
                <button
                    className={activeTab === "pdfjs" ? "tab active" : "tab"}
                    onClick={() => setActiveTab("pdfjs")}
                >
                    Prototype 1: PDF.js Canvas + SVG Overlay
                </button>
                <button
                    className={activeTab === "reactpdf" ? "tab active" : "tab"}
                    onClick={() => setActiveTab("reactpdf")}
                >
                    Prototype 2: @react-pdf-viewer
                </button>
            </div>

            <div className="viewer-container">
                {activeTab === "pdfjs" && <PdfJsCanvasViewer pdfUrl={PDF_URL} />}
                {activeTab === "reactpdf" && <ReactPdfViewer pdfUrl={PDF_URL} />}
            </div>
        </div>
    )
}
