import { useRef, useState } from "react"
import { PdfJsCanvasViewer } from "./prototypes/PdfJsCanvasViewer/PdfJsCanvasViewer"
import "./App.css"

export default function App() {
    const [pdfUrl, setPdfUrl] = useState("/sample.pdf")
    const [fileName, setFileName] = useState("sample.pdf")
    const fileInputRef = useRef<HTMLInputElement>(null)
    const objectUrlRef = useRef<string | null>(null)

    function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
        const file = e.target.files?.[0]
        if (!file) return
        if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current)
        const url = URL.createObjectURL(file)
        objectUrlRef.current = url
        setPdfUrl(url)
        setFileName(file.name)
        e.target.value = ""
    }

    return (
        <div className="app">
            <div className="app-header">
                <div>
                    <h1>Blueprint Viewer POC</h1>
                    <p>AJB-14024 — Technology survey: PDF rendering with registration mark overlay</p>
                </div>
                <div className="upload-area">
                    <span className="file-name">{fileName}</span>
                    <button className="upload-btn" onClick={() => fileInputRef.current?.click()}>
                        Upload PDF
                    </button>
                    <input
                        ref={fileInputRef}
                        type="file"
                        accept=".pdf,application/pdf"
                        style={{ display: "none" }}
                        onChange={handleFileChange}
                    />
                </div>
            </div>

            <div className="viewer-container">
                <PdfJsCanvasViewer pdfUrl={pdfUrl} />
            </div>
        </div>
    )
}
