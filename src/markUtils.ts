import type { RegistrationMark } from "./types"

export const MARK_COLORS = ["#f5d125", "#4bdc1d", "#ef4319", "#3ab2c5"]

export const HIT_RADIUS = 20

export function hitTestMark(
    marks: RegistrationMark[],
    clickSX: number,
    clickSY: number,
    toScreen: (mark: RegistrationMark) => { sx: number; sy: number },
    radius = HIT_RADIUS,
): RegistrationMark | null {
    const r2 = radius * radius
    for (let i = marks.length - 1; i >= 0; i--) {
        const { sx, sy } = toScreen(marks[i])
        const dx = clickSX - sx
        const dy = clickSY - sy
        if (dx * dx + dy * dy <= r2) return marks[i]
    }
    return null
}

export function nextLabel(marks: RegistrationMark[]): number {
    return marks.reduce((max, m) => (m.label > max ? m.label : max), 0) + 1
}

export function nextColor(marks: RegistrationMark[]): string {
    return MARK_COLORS[marks.length % MARK_COLORS.length]
}

export function newId(): string {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
        return crypto.randomUUID()
    }
    return `m-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
}
