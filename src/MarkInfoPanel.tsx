import type { RegistrationMark } from "./types"
import "./MarkInfoPanel.css"

interface Props {
    mark: RegistrationMark
    screenX: number
    screenY: number
    onClose: () => void
}

export function MarkInfoPanel({ mark, screenX, screenY, onClose }: Props) {
    return (
        <div
            className="mark-info-panel"
            style={{ left: screenX + 16, top: screenY - 12 }}
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => e.stopPropagation()}
        >
            <div className="mark-info-header">
                <span className="mark-info-swatch" style={{ background: mark.color }} />
                <span className="mark-info-title">Mark #{mark.label}</span>
                <button
                    className="mark-info-close"
                    onClick={onClose}
                    aria-label="Close"
                    type="button"
                >
                    ×
                </button>
            </div>
            <div className="mark-info-row">
                <span className="mark-info-key">x</span>
                <span className="mark-info-val">{Math.round(mark.x)}</span>
            </div>
            <div className="mark-info-row">
                <span className="mark-info-key">y</span>
                <span className="mark-info-val">{Math.round(mark.y)}</span>
            </div>
        </div>
    )
}
