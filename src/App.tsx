import { PdfJsCanvasViewer } from "./prototypes/PdfJsCanvasViewer/PdfJsCanvasViewer"
import "./App.css"

const PDF_URL = "/sample.pdf"

export default function App() {
    return (
        <div className="app">
            <h1>Blueprint Viewer POC</h1>
            <p>AJB-14024 — Technology survey: PDF rendering with registration mark overlay</p>

            <div className="viewer-container">
                <PdfJsCanvasViewer pdfUrl={PDF_URL} />
            </div>
        </div>
    )
}
