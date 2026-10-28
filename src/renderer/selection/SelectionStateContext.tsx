import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode
} from 'react'

/**
 * Cross-surface selection (v1): shared equipment id set only.
 */
export type SelectionState = {
  /** Current selection; do not mutate — use setters. */
  readonly selectedEquipmentIds: ReadonlySet<string>
  getSelectedEquipmentIds: () => Set<string>
  setSelectedEquipmentIds: (ids: ReadonlySet<string> | Set<string> | readonly string[] | string[]) => void
  clearSelectedEquipmentIds: () => void
  isSelected: (id: string) => boolean
}

const SelectionStateContext = createContext<SelectionState | null>(null)

export function useSelectionState(): SelectionState {
  const ctx = useContext(SelectionStateContext)
  if (ctx == null) {
    throw new Error('useSelectionState must be used within SelectionStateProvider')
  }
  return ctx
}

export function SelectionStateProvider({ children }: { children: ReactNode }): JSX.Element {
  const api = window.ssApi
  const [selectedEquipmentIds, setSelectedEquipmentIdsState] = useState<Set<string>>(() => new Set())
  const selectedEquipmentIdsRef = useRef(selectedEquipmentIds)
  selectedEquipmentIdsRef.current = selectedEquipmentIds
  const lastEmittedSigRef = useRef<string>('')

  const sigOf = useCallback((ids: Iterable<string>) => [...ids].sort().join(','), [])

  useEffect(() => {
    // Missing preload: let App render its own diagnostic instead of crashing the tree here.
    if (!api) return
    let cancelled = false
    void api.getSelectedEquipmentIds().then((ids) => {
      if (cancelled) return
      const next = new Set(ids)
      lastEmittedSigRef.current = sigOf(next)
      setSelectedEquipmentIdsState(next)
    })
    const unsub = api.onSelectedEquipmentIdsChanged((p) => {
      const next = new Set(p.selectedEquipmentIds)
      const sig = sigOf(next)
      if (sig === sigOf(selectedEquipmentIdsRef.current)) return
      lastEmittedSigRef.current = sig
      setSelectedEquipmentIdsState(next)
    })
    return () => {
      cancelled = true
      unsub()
    }
  }, [api, sigOf])

  const setSelectedEquipmentIds = useCallback(
    (ids: ReadonlySet<string> | Set<string> | readonly string[] | string[]) => {
      const next = ids instanceof Set ? new Set(ids) : new Set(ids)
      const sig = sigOf(next)
      if (sig === sigOf(selectedEquipmentIdsRef.current)) return
      setSelectedEquipmentIdsState(next)
      // Push authoritative update to main (broadcasts to other windows).
      if (sig !== lastEmittedSigRef.current) {
        lastEmittedSigRef.current = sig
        void api?.setSelectedEquipmentIds([...next])
      }
    },
    [api, sigOf]
  )

  const clearSelectedEquipmentIds = useCallback(() => {
    setSelectedEquipmentIds(new Set())
  }, [setSelectedEquipmentIds])

  const getSelectedEquipmentIds = useCallback(() => new Set(selectedEquipmentIdsRef.current), [])

  const isSelected = useCallback((id: string) => selectedEquipmentIdsRef.current.has(id), [])

  const value = useMemo((): SelectionState => {
    const readOnly = selectedEquipmentIds as ReadonlySet<string>
    return {
      selectedEquipmentIds: readOnly,
      getSelectedEquipmentIds,
      setSelectedEquipmentIds,
      clearSelectedEquipmentIds,
      isSelected
    }
  }, [selectedEquipmentIds, getSelectedEquipmentIds, setSelectedEquipmentIds, clearSelectedEquipmentIds, isSelected])

  return <SelectionStateContext.Provider value={value}>{children}</SelectionStateContext.Provider>
}
