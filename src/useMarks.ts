import { useCallback, useEffect, useState } from "react"
import type { RegistrationMark } from "./types"
import { MOCK_MARKS } from "./mockMarks"
import { newId, nextColor, nextLabel } from "./markUtils"

function loadMarks(storageKey: string): RegistrationMark[] {
    try {
        const raw = localStorage.getItem(storageKey)
        if (raw) {
            const parsed = JSON.parse(raw) as RegistrationMark[]
            if (Array.isArray(parsed)) return parsed
        }
    } catch {
        // ignore corrupt storage
    }
    return MOCK_MARKS
}

export function useMarks(storageKey: string) {
    const [marks, setMarks] = useState<RegistrationMark[]>(() => loadMarks(storageKey))
    const [selectedId, setSelectedId] = useState<string | null>(null)

    useEffect(() => {
        localStorage.setItem(storageKey, JSON.stringify(marks))
    }, [marks, storageKey])

    const addMark = useCallback((x: number, y: number) => {
        setMarks((prev) => [
            ...prev,
            { id: newId(), x, y, label: nextLabel(prev), color: nextColor(prev) },
        ])
    }, [])

    const moveMark = useCallback((id: string, x: number, y: number) => {
        setMarks((prev) => prev.map((m) => (m.id === id ? { ...m, x, y } : m)))
    }, [])

    const selectMark = useCallback((id: string | null) => {
        setSelectedId(id)
    }, [])

    const toggleSelectMark = useCallback((id: string) => {
        setSelectedId((prev) => (prev === id ? null : id))
    }, [])

    return { marks, selectedId, addMark, moveMark, selectMark, toggleSelectMark }
}
