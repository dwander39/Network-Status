import {
  createContext,
  useCallback,
  useContext,
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
  const [selectedEquipmentIds, setSelectedEquipmentIdsState] = useState<Set<string>>(() => new Set())
  const selectedEquipmentIdsRef = useRef(selectedEquipmentIds)
  selectedEquipmentIdsRef.current = selectedEquipmentIds

  const setSelectedEquipmentIds = useCallback(
    (ids: ReadonlySet<string> | Set<string> | readonly string[] | string[]) => {
      setSelectedEquipmentIdsState(ids instanceof Set ? new Set(ids) : new Set(ids))
    },
    []
  )

  const clearSelectedEquipmentIds = useCallback(() => {
    setSelectedEquipmentIdsState(new Set())
  }, [])

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
