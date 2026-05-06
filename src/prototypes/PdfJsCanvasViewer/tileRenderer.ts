import type { PDFPageProxy, RenderTask } from "pdfjs-dist"

const TILE_SIZE = 512
const BUFFER_TILES = 1

type TileKey = string

type TileEntry = {
    canvas: HTMLCanvasElement
    task: RenderTask | null
}

export interface UpdateOpts {
    scrollLeft: number
    scrollTop: number
    viewportWidth: number
    viewportHeight: number
    pageWidth: number
    pageHeight: number
    offsetX: number
    offsetY: number
}

export class TileRenderer {
    private cache = new Map<TileKey, TileEntry>()
    private currentZoom = 0
    private page: PDFPageProxy | null = null
    private container: HTMLElement

    constructor(container: HTMLElement) {
        this.container = container
    }

    setPage(page: PDFPageProxy) {
        if (this.page === page) return
        this.page = page
        this.clearAll()
    }

    setZoom(zoom: number) {
        if (zoom === this.currentZoom) return
        this.currentZoom = zoom
        this.clearAll()
    }

    update(opts: UpdateOpts) {
        if (!this.page || this.currentZoom === 0) return

        const { scrollLeft, scrollTop, viewportWidth, viewportHeight, pageWidth, pageHeight, offsetX, offsetY } = opts

        const visLeft = Math.max(0, scrollLeft - offsetX)
        const visTop = Math.max(0, scrollTop - offsetY)
        const visRight = Math.min(pageWidth, scrollLeft - offsetX + viewportWidth)
        const visBottom = Math.min(pageHeight, scrollTop - offsetY + viewportHeight)

        if (visRight <= 0 || visBottom <= 0 || visLeft >= pageWidth || visTop >= pageHeight) {
            this.clearAll()
            return
        }

        const cols = Math.ceil(pageWidth / TILE_SIZE)
        const rows = Math.ceil(pageHeight / TILE_SIZE)

        const startCol = Math.max(0, Math.floor(visLeft / TILE_SIZE) - BUFFER_TILES)
        const startRow = Math.max(0, Math.floor(visTop / TILE_SIZE) - BUFFER_TILES)
        const endCol = Math.min(cols - 1, Math.floor((visRight - 1) / TILE_SIZE) + BUFFER_TILES)
        const endRow = Math.min(rows - 1, Math.floor((visBottom - 1) / TILE_SIZE) + BUFFER_TILES)

        const needed = new Set<TileKey>()
        for (let r = startRow; r <= endRow; r++) {
            for (let c = startCol; c <= endCol; c++) {
                needed.add(this.key(r, c))
            }
        }

        for (const [key, entry] of this.cache) {
            if (!needed.has(key)) {
                entry.task?.cancel()
                entry.canvas.remove()
                this.cache.delete(key)
            }
        }

        for (let r = startRow; r <= endRow; r++) {
            for (let c = startCol; c <= endCol; c++) {
                const k = this.key(r, c)
                if (!this.cache.has(k)) {
                    this.renderTile(r, c, pageWidth, pageHeight)
                }
            }
        }
    }

    clearAll() {
        for (const entry of this.cache.values()) {
            entry.task?.cancel()
            entry.canvas.remove()
        }
        this.cache.clear()
    }

    destroy() {
        this.clearAll()
        this.page = null
    }

    private key(row: number, col: number): TileKey {
        return `${this.currentZoom}-${row}-${col}`
    }

    private renderTile(row: number, col: number, pageWidth: number, pageHeight: number) {
        const page = this.page
        if (!page) return

        // Integer pixel origins + clamped sizes — keeps tile edges aligned and avoids seams.
        const tileX = col * TILE_SIZE
        const tileY = row * TILE_SIZE
        const tileW = Math.min(TILE_SIZE, pageWidth - tileX)
        const tileH = Math.min(TILE_SIZE, pageHeight - tileY)
        if (tileW <= 0 || tileH <= 0) return

        const canvas = document.createElement("canvas")
        canvas.width = tileW
        canvas.height = tileH
        canvas.className = "pdfjs-tile"
        canvas.style.position = "absolute"
        canvas.style.left = `${tileX}px`
        canvas.style.top = `${tileY}px`
        canvas.style.width = `${tileW}px`
        canvas.style.height = `${tileH}px`

        this.container.appendChild(canvas)

        const ctx = canvas.getContext("2d")
        if (!ctx) return

        const viewport = page.getViewport({ scale: this.currentZoom })
        const task = page.render({
            canvasContext: ctx,
            viewport,
            transform: [1, 0, 0, 1, -tileX, -tileY],
        })

        const k = this.key(row, col)
        const entry: TileEntry = { canvas, task }
        this.cache.set(k, entry)

        task.promise
            .then(() => {
                if (this.cache.get(k) === entry) entry.task = null
            })
            .catch((e: unknown) => {
                const name = (e as { name?: string })?.name
                if (name === "RenderingCancelledException") return
                // Per-tile errors are tolerable: drop the tile so a future update can retry.
                if (this.cache.get(k) === entry) {
                    entry.canvas.remove()
                    this.cache.delete(k)
                }
            })
    }
}
