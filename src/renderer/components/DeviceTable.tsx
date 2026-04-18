import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent,
  type PointerEvent
} from 'react'
import { getDeviceTypeDisplayLabel } from '@shared/deviceTypeDisplay'
import type { Device, DeviceGroup, DeviceStatus, SaveDevicePayload } from '@shared/types'
import { isValidIPv4 } from '@shared/ipValidation'
import { useSelectionState } from '../selection/SelectionStateContext'

export type SortKey = 'name' | 'group' | 'status' | 'lastChecked'

type EditableField = 'name' | 'ip' | 'subnet' | 'gateway'

export type GroupByMode = 'none' | 'subnet' | 'vendor' | 'deviceType'

interface Props {
  devices: Device[]
  groups: DeviceGroup[]
  groupBy: GroupByMode
  sortKey: SortKey
  sortDir: 'asc' | 'desc'
  onSort: (k: SortKey) => void
  onDelete: (id: string) => void
  onSetDeviceGroup: (deviceId: string, groupId: string | null) => Promise<void>
  onSaveDevice: (payload: SaveDevicePayload) => Promise<void>
  extraColumns?: string[]
  getExtraColumnValue?: (deviceId: string, col: string) => string
  onSetExtraColumnValue?: (deviceId: string, col: string, value: string) => void
  onRenameExtraColumn?: (oldName: string, newName: string) => void
  onDeleteExtraColumn?: (name: string) => void
  getColumnWidthPx?: (key: string) => number | undefined
  onSetColumnWidthPx?: (key: string, widthPx: number) => void
  hiddenColumns?: Record<string, boolean>
  /** When set and the device row is present, open inline edit on the Name cell once (e.g. after Add device). */
  focusNameEditDeviceId?: string | null
  onFocusNameEditHandled?: () => void
}

function statusClass(s: DeviceStatus): string {
  if (s === 'online') return 'status-online'
  if (s === 'offline') return 'status-offline'
  return 'status-unknown'
}

function formatTime(iso: string | null): string {
  if (!iso) return '—'
  try {
    const d = new Date(iso)
    return d.toLocaleString()
  } catch {
    return iso
  }
}

/** Squared distance must exceed this (px²) before drag-selection applies (Step 4). */
const DRAG_SELECT_THRESHOLD_SQ = 4 * 4

/** While a real drag is active, block native selection outside editable controls. */
function preventNativeSelectWhileDeviceTableDrag(ev: Event): void {
  const el = ev.target
  if (!(el instanceof HTMLElement)) return
  if (el.closest('input, textarea, [contenteditable="true"]')) return
  ev.preventDefault()
}

export function DeviceTable({
  devices,
  groups,
  groupBy,
  sortKey,
  sortDir,
  onSort,
  onDelete,
  onSetDeviceGroup,
  onSaveDevice,
  extraColumns = [],
  getExtraColumnValue,
  onSetExtraColumnValue,
  onRenameExtraColumn,
  onDeleteExtraColumn,
  getColumnWidthPx,
  onSetColumnWidthPx,
  hiddenColumns,
  focusNameEditDeviceId,
  onFocusNameEditHandled
}: Props): JSX.Element {
  /** Row highlight + cross-surface sync: final selected equipment ids from shared state (Step 2). */
  const { selectedEquipmentIds, setSelectedEquipmentIds, clearSelectedEquipmentIds, getSelectedEquipmentIds } =
    useSelectionState()
  /** Multi-select + range (Shift); anchor in ref — local only. */
  const anchorRef = useRef<string | null>(null)
  /** Drag gesture: potential drag on pointerdown; commits selection in pointermove after threshold (Steps 1–4). */
  const dragGestureActiveRef = useRef(false)
  const dragStartRowIndexRef = useRef<number | null>(null)
  const dragStartPointerRef = useRef<{ x: number; y: number } | null>(null)
  /** Inclusive index range from drag start to current hover; null if pointer not over a device row. */
  const dragCurrentRangeRef = useRef<{ rangeStart: number; rangeEnd: number } | null>(null)
  const orderedVisibleDeviceIdsRef = useRef<readonly string[]>([])
  const dragPointerMoveFnRef = useRef<((ev: PointerEvent) => void) | null>(null)
  const dragPointerEndFnRef = useRef<(() => void) | null>(null)
  const dragSelectionAppliedRef = useRef(false)
  const skipNextRowClickRef = useRef(false)
  const dragPassedThresholdRef = useRef(false)
  /**
   * Locked for one gesture at pointerdown: replace | add (Ctrl/Cmd) | subtract (Alt/Option).
   * Precedence when multiple modifiers: subtract > add > replace. Shift still blocks drag start.
   */
  const dragSelectionModeRef = useRef<'replace' | 'add' | 'subtract' | null>(null)
  /**
   * Snapshot of selection at drag start for 'add' and 'subtract' modes (replace: null).
   * Copy so later pointermove updates do not mutate it; subtract application deferred.
   */
  const dragBaseSelectionRef = useRef<Set<string> | null>(null)
  const [editing, setEditing] = useState<{ id: string; field: EditableField } | null>(null)
  const [draft, setDraft] = useState('')
  const [editingExtra, setEditingExtra] = useState<{ id: string; col: string } | null>(null)
  const [draftExtra, setDraftExtra] = useState('')
  const [renamingCol, setRenamingCol] = useState<string | null>(null)
  const [draftColName, setDraftColName] = useState('')
  const [saving, setSaving] = useState(false)

  const resizeRef = useRef<{ key: string; startX: number; startW: number } | null>(null)

  useEffect(() => {
    const onMove = (e: PointerEvent): void => {
      const r = resizeRef.current
      if (!r) return
      const next = Math.max(60, Math.round(r.startW + (e.clientX - r.startX)))
      onSetColumnWidthPx?.(r.key, next)
    }
    const onUp = (): void => {
      resizeRef.current = null
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    return () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
    }
  }, [onSetColumnWidthPx])

  useLayoutEffect(() => {
    if (!focusNameEditDeviceId) return
    const d = devices.find((x) => x.id === focusNameEditDeviceId)
    if (!d) return
    const row = document.querySelector(`[data-device-row="${d.id}"]`)
    row?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
    setEditing({ id: d.id, field: 'name' })
    setDraft(String(d.name ?? ''))
    onFocusNameEditHandled?.()
  }, [focusNameEditDeviceId, devices, onFocusNameEditHandled])

  const label = (k: SortKey, text: string): string =>
    sortKey === k ? `${text} ${sortDir === 'asc' ? '▲' : '▼'}` : text

  const deviceById = useMemo(() => {
    const m = new Map<string, Device>()
    for (const d of devices) m.set(d.id, d)
    return m
  }, [devices])

  function startEditCell(d: Device, field: EditableField): void {
    setEditing({ id: d.id, field })
    setDraft(String(d[field] ?? ''))
  }

  function cancelEdit(): void {
    setEditing(null)
    setDraft('')
    setEditingExtra(null)
    setDraftExtra('')
    setRenamingCol(null)
    setDraftColName('')
  }

  async function commitEdit(): Promise<void> {
    if (!editing || saving) return
    const d = deviceById.get(editing.id)
    if (!d) return cancelEdit()

    const nextValue = draft.trim()
    const prevValue = String(d[editing.field] ?? '')
    if (nextValue === prevValue) return cancelEdit()

    if (editing.field === 'name' && !nextValue) {
      alert('Name is required.')
      return
    }
    if (editing.field === 'ip' && !isValidIPv4(nextValue)) {
      alert('IP address must be valid IPv4.')
      return
    }
    if (editing.field === 'subnet' && nextValue && !isValidIPv4(nextValue)) {
      alert('Subnet mask must be valid IPv4.')
      return
    }
    if (editing.field === 'gateway' && nextValue && !isValidIPv4(nextValue)) {
      alert('Gateway must be valid IPv4.')
      return
    }

    setSaving(true)
    try {
      await onSaveDevice({
        id: d.id,
        name: editing.field === 'name' ? nextValue : d.name,
        ip: editing.field === 'ip' ? nextValue : d.ip,
        subnet: editing.field === 'subnet' ? nextValue : d.subnet,
        gateway: editing.field === 'gateway' ? nextValue : d.gateway,
        groupId: d.groupId
      })
      cancelEdit()
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Save failed.')
    } finally {
      setSaving(false)
    }
  }

  function renderEditableCell(d: Device, field: EditableField): JSX.Element {
    const isEditing = editing?.id === d.id && editing.field === field
    if (!isEditing) {
      return (
        <span
          className="cell-editable"
          title="Click to edit"
          onClick={(e) => {
            applyRowMouseSelection(d.id, e)
            if (!e.shiftKey && !selectionModifier(e)) startEditCell(d, field)
            e.stopPropagation()
          }}
        >
          {/* Phase-1 resolved read contract: empty string is meaningful; do not coerce to absence/placeholder. */}
          {d[field]}
        </span>
      )
    }
    return (
      <input
        className="table-input"
        type="text"
        autoComplete="off"
        value={draft}
        disabled={saving}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => void commitEdit()}
        onKeyDown={(e) => {
          if (e.key === 'Enter') void commitEdit()
          if (e.key === 'Escape') cancelEdit()
        }}
        autoFocus
      />
    )
  }

  function renderExtraColumnCell(d: Device, col: string): JSX.Element {
    const isEditing = editingExtra?.id === d.id && editingExtra.col === col
    const v = getExtraColumnValue?.(d.id, col) ?? ''
    if (!isEditing) {
      return (
        <span
          className="cell-editable"
          title="Click to edit"
          onClick={(e) => {
            applyRowMouseSelection(d.id, e)
            if (!e.shiftKey && !selectionModifier(e)) {
              setEditing(null)
              setDraft('')
              setEditingExtra({ id: d.id, col })
              setDraftExtra(v)
            }
            e.stopPropagation()
          }}
        >
          {v}
        </span>
      )
    }
    return (
      <input
        className="table-input"
        type="text"
        autoComplete="off"
        value={draftExtra}
        disabled={saving}
        onChange={(e) => setDraftExtra(e.target.value)}
        onBlur={() => {
          onSetExtraColumnValue?.(d.id, col, draftExtra)
          cancelEdit()
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            onSetExtraColumnValue?.(d.id, col, draftExtra)
            cancelEdit()
          }
          if (e.key === 'Escape') cancelEdit()
        }}
        autoFocus
      />
    )
  }

  function subnetGroupLabel(d: Device): string {
    const parts = d.ip.split('.')
    if (parts.length === 4) return `${parts[0]}.${parts[1]}.${parts[2]}.x`
    return 'Subnet'
  }

  function groupLabel(d: Device): string {
    if (groupBy === 'subnet') return subnetGroupLabel(d)
    // Phase-1 resolved read contract: vendor absence is explicit (null) and should render as placeholder, not a new meaning.
    if (groupBy === 'vendor') return d.vendor?.trim() ? d.vendor.trim() : '—'
    if (groupBy === 'deviceType') return getDeviceTypeDisplayLabel(d)
    return ''
  }

  const grouped = useMemo(() => {
    if (groupBy === 'none') return [{ label: '', devices }]
    const out: { label: string; devices: Device[] }[] = []
    let currentLabel: string | null = null
    let bucket: Device[] = []
    for (const d of devices) {
      const l = groupLabel(d)
      if (currentLabel === null) {
        currentLabel = l
        bucket = [d]
      } else if (l === currentLabel) {
        bucket.push(d)
      } else {
        out.push({ label: currentLabel, devices: bucket })
        currentLabel = l
        bucket = [d]
      }
    }
    if (currentLabel !== null) out.push({ label: currentLabel, devices: bucket })
    return out
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [devices, groupBy])

  /** Device row ids in current table body order (group headers excluded). */
  const orderedVisibleDeviceIds = useMemo(() => {
    const ids: string[] = []
    for (const g of grouped) {
      for (const d of g.devices) ids.push(d.id)
    }
    return ids
  }, [grouped])

  orderedVisibleDeviceIdsRef.current = orderedVisibleDeviceIds

  function inclusiveDeviceIdRange(order: readonly string[], a: string, b: string): Set<string> | null {
    const ia = order.indexOf(a)
    const ib = order.indexOf(b)
    if (ia === -1 || ib === -1) return null
    const lo = Math.min(ia, ib)
    const hi = Math.max(ia, ib)
    return new Set(order.slice(lo, hi + 1))
  }

  function selectionModifier(e: MouseEvent<Element>): boolean {
    return e.metaKey || e.ctrlKey
  }

  /**
   * Plain click (no modifiers): exactly that row selected, all others cleared; anchor = row (v1.1: only plain + drag start set anchor).
   * Ctrl/Cmd: toggle row (does not update anchor).
   * Shift (no Ctrl/Cmd): range anchor→row if anchor set; else same as plain selection (does not update anchor).
   * After drag, row onClick may bail out (skipNextRowClickRef) so this is not called on the release click.
   */
  function applyRowMouseSelection(id: string, e: MouseEvent<Element>): void {
    const mod = selectionModifier(e)
    const shiftOnly = e.shiftKey && !mod

    if (shiftOnly) {
      const anchor = anchorRef.current
      if (anchor == null) {
        setSelectedEquipmentIds(new Set([id]))
        return
      }
      const range = inclusiveDeviceIdRange(orderedVisibleDeviceIds, anchor, id)
      if (range == null) {
        setSelectedEquipmentIds(new Set([id]))
        return
      }
      setSelectedEquipmentIds(range)
      return
    }

    if (mod) {
      const prev = getSelectedEquipmentIds()
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      setSelectedEquipmentIds(next)
      return
    }

    setSelectedEquipmentIds(new Set([id]))
    anchorRef.current = id
  }

  useEffect(() => {
    const allowed = new Set(devices.map((d) => d.id))
    if (anchorRef.current != null && !allowed.has(anchorRef.current)) {
      anchorRef.current = null
    }
  }, [devices])

  useEffect(() => {
    if (anchorRef.current != null && !selectedEquipmentIds.has(anchorRef.current)) {
      anchorRef.current = null
    }
  }, [selectedEquipmentIds])

  /** Local anchor only: if pivot row is not in the current table body order, clear anchor (does not mutate shared selection). */
  useEffect(() => {
    const visible = new Set(orderedVisibleDeviceIds)
    if (anchorRef.current != null && !visible.has(anchorRef.current)) {
      anchorRef.current = null
    }
  }, [orderedVisibleDeviceIds])

  useEffect(() => {
    return () => {
      dragSelectionModeRef.current = null
      dragBaseSelectionRef.current = null
      window.removeEventListener('selectstart', preventNativeSelectWhileDeviceTableDrag, true)
      const move = dragPointerMoveFnRef.current
      if (move) {
        window.removeEventListener('pointermove', move)
        dragPointerMoveFnRef.current = null
      }
      const end = dragPointerEndFnRef.current
      if (end) {
        window.removeEventListener('pointerup', end)
        window.removeEventListener('pointercancel', end)
        dragPointerEndFnRef.current = null
      }
    }
  }, [])

  function handleDeviceRowPointerDown(d: Device, e: PointerEvent<HTMLTableRowElement>): void {
    if (e.button !== 0) return
    if (e.shiftKey) return
    const tgt = e.target as HTMLElement
    if (tgt.closest('button, input, select, textarea, a, [contenteditable="true"]')) return
    if (editing?.id === d.id || editingExtra?.id === d.id) return
    const idx = orderedVisibleDeviceIds.indexOf(d.id)
    if (idx < 0) return

    const prevEnd = dragPointerEndFnRef.current
    if (prevEnd) {
      window.removeEventListener('pointerup', prevEnd)
      window.removeEventListener('pointercancel', prevEnd)
      dragPointerEndFnRef.current = null
    }
    const prevMove = dragPointerMoveFnRef.current
    if (prevMove) {
      window.removeEventListener('pointermove', prevMove)
      dragPointerMoveFnRef.current = null
    }

    dragGestureActiveRef.current = true
    if (e.altKey) {
      dragSelectionModeRef.current = 'subtract'
    } else if (e.metaKey || e.ctrlKey) {
      dragSelectionModeRef.current = 'add'
    } else {
      dragSelectionModeRef.current = 'replace'
    }
    const mode = dragSelectionModeRef.current
    dragBaseSelectionRef.current =
      mode === 'add' || mode === 'subtract' ? new Set(getSelectedEquipmentIds()) : null
    dragStartRowIndexRef.current = idx
    anchorRef.current = orderedVisibleDeviceIds[idx] ?? d.id
    dragStartPointerRef.current = { x: e.clientX, y: e.clientY }
    dragCurrentRangeRef.current = null
    dragPassedThresholdRef.current = false
    dragSelectionAppliedRef.current = false

    const move = (ev: PointerEvent): void => {
      if (!dragGestureActiveRef.current) return
      const startIdx = dragStartRowIndexRef.current
      const startPtr = dragStartPointerRef.current
      if (startIdx == null || startPtr == null) return

      const dx = ev.clientX - startPtr.x
      const dy = ev.clientY - startPtr.y
      if (!dragPassedThresholdRef.current) {
        if (dx * dx + dy * dy < DRAG_SELECT_THRESHOLD_SQ) return
        dragPassedThresholdRef.current = true
        window.addEventListener('selectstart', preventNativeSelectWhileDeviceTableDrag, true)
      }
      // Step 5 (v1.1): past movement threshold for this move; early returns below do not set applied/suppression.

      const el = document.elementFromPoint(ev.clientX, ev.clientY)
      const rowEl = el?.closest?.('[data-device-row]') as HTMLElement | null
      if (!rowEl) {
        return
      }
      const id = rowEl.getAttribute('data-device-row')
      if (!id) {
        return
      }
      const order = orderedVisibleDeviceIdsRef.current
      const curIdx = order.indexOf(id)
      if (curIdx < 0) {
        return
      }
      const range = {
        rangeStart: Math.min(startIdx, curIdx),
        rangeEnd: Math.max(startIdx, curIdx)
      }
      dragCurrentRangeRef.current = range
      const startId = order[startIdx]
      const curId = order[curIdx]
      if (!startId || !curId) return
      const rangeIds = inclusiveDeviceIdRange(order, startId, curId)
      if (!rangeIds) return
      const mode = dragSelectionModeRef.current
      if (mode === 'add') {
        const next = new Set(dragBaseSelectionRef.current ?? [])
        for (const rid of rangeIds) next.add(rid)
        setSelectedEquipmentIds(next)
      } else if (mode === 'subtract') {
        // Step 4 (v1.1): subtract only from the pointerdown snapshot — not from ad-hoc live reads beyond base ref.
        // Delete only range ids that were in that base; unselected rows in the range are untouched.
        const base = dragBaseSelectionRef.current ?? new Set<string>()
        const next = new Set(base)
        for (const rid of rangeIds) {
          if (base.has(rid)) next.delete(rid)
        }
        setSelectedEquipmentIds(next)
      } else {
        setSelectedEquipmentIds(rangeIds)
      }
      // Step 5 (v1.1): real drag-applied selection this frame → end() may arm post-drag click skip only then.
      dragSelectionAppliedRef.current = true
    }
    dragPointerMoveFnRef.current = move
    window.addEventListener('pointermove', move)

    const end = (): void => {
      window.removeEventListener('selectstart', preventNativeSelectWhileDeviceTableDrag, true)
      const mv = dragPointerMoveFnRef.current
      if (mv) {
        window.removeEventListener('pointermove', mv)
        dragPointerMoveFnRef.current = null
      }
      // Step 5 (v1.1): applied only if a move committed selection after crossing threshold; sub-threshold
      // gesture never sets applied, so skipNextRowClickRef is not armed and the row click runs normally.
      // When applied, selection is the last pointermove result; suppress release click (plain/modifiers/Alt).
      const applied = dragSelectionAppliedRef.current
      dragSelectionAppliedRef.current = false
      if (applied) {
        skipNextRowClickRef.current = true
        // Bubble on window runs after React's delegated row click, so the row can see skip first.
        window.addEventListener(
          'click',
          () => {
            skipNextRowClickRef.current = false
          },
          { once: true }
        )
      }
      dragGestureActiveRef.current = false
      dragSelectionModeRef.current = null
      dragBaseSelectionRef.current = null
      dragStartRowIndexRef.current = null
      dragStartPointerRef.current = null
      dragCurrentRangeRef.current = null
      dragPassedThresholdRef.current = false
      window.removeEventListener('pointerup', end)
      window.removeEventListener('pointercancel', end)
      dragPointerEndFnRef.current = null
    }
    dragPointerEndFnRef.current = end
    window.addEventListener('pointerup', end)
    window.addEventListener('pointercancel', end)
  }

  const isHidden = (k: string): boolean => hiddenColumns?.[k] === true
  const visibleExtraColumns = extraColumns.filter((c) => !isHidden(c))
  const colKeys = [
    'name',
    'status',
    'ip',
    'subnet',
    'gateway',
    ...visibleExtraColumns,
    'type',
    'mac',
    'vendor',
    'lastChecked',
    'actions'
  ].filter((k) => !isHidden(k))

  const colCount = colKeys.length

  const th = (key: string, content: React.ReactNode, opts?: { sortable?: boolean; onClick?: () => void }) => {
    const w = getColumnWidthPx?.(key)
    const style = w != null ? ({ width: `${w}px` } as React.CSSProperties) : undefined
    return (
      <th
        key={key}
        className="device-th"
        style={style}
        onClick={opts?.onClick}
      >
        <span className="device-th__content">{content}</span>
        <span
          className="device-th__resize-handle"
          onPointerDown={(e) => {
            e.stopPropagation()
            const el = (e.currentTarget.parentElement as HTMLElement | null) ?? null
            const startW = el ? el.getBoundingClientRect().width : 120
            resizeRef.current = { key, startX: e.clientX, startW }
          }}
        />
      </th>
    )
  }

  function handleTableWrapMouseDown(e: MouseEvent<HTMLDivElement>): void {
    const tgt = e.target as HTMLElement
    if (tgt.closest('[data-device-row]')) return
    if (tgt.closest('thead')) return
    if (tgt.closest('button, input, select, textarea')) return
    if (tgt.closest('table.device-table')) {
      clearSelectedEquipmentIds()
      anchorRef.current = null
      return
    }
    if (e.target === e.currentTarget) {
      clearSelectedEquipmentIds()
      anchorRef.current = null
    }
  }

  return (
    <div className="table-wrap" onMouseDown={handleTableWrapMouseDown}>
      <table className="device-table">
        <colgroup>
          {colKeys.map((k) => {
            const w = getColumnWidthPx?.(k)
            return <col key={k} style={w != null ? ({ width: `${w}px` } as React.CSSProperties) : undefined} />
          })}
        </colgroup>
        <thead>
          <tr>
            {!isHidden('name') ? th('name', label('name', 'Name'), { sortable: true, onClick: () => onSort('name') }) : null}
            {!isHidden('status') ? th('status', label('status', 'Status'), { sortable: true, onClick: () => onSort('status') }) : null}
            {!isHidden('ip') ? th('ip', 'IP') : null}
            {!isHidden('subnet') ? th('subnet', 'Subnet') : null}
            {!isHidden('gateway') ? th('gateway', 'Gateway') : null}
            {visibleExtraColumns.map((c) =>
              th(
                c,
                renamingCol === c ? (
                  <input
                    className="table-input"
                    type="text"
                    value={draftColName}
                    onChange={(e) => setDraftColName(e.target.value)}
                    onBlur={() => {
                      const next = draftColName.trim()
                      if (next && next !== c) {
                        onRenameExtraColumn?.(c, next)
                      }
                      cancelEdit()
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        const next = draftColName.trim()
                        if (next && next !== c) {
                          onRenameExtraColumn?.(c, next)
                        }
                        cancelEdit()
                      }
                      if (e.key === 'Escape') cancelEdit()
                    }}
                    autoFocus
                  />
                ) : (
                  <span style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                    <span
                      onClick={(e) => {
                        e.stopPropagation()
                        setEditing(null)
                        setDraft('')
                        setEditingExtra(null)
                        setDraftExtra('')
                        setRenamingCol(c)
                        setDraftColName(c)
                      }}
                    >
                      {c}
                    </span>
                    <button
                      type="button"
                      className="danger-icon"
                      title={`Delete column “${c}”`}
                      aria-label={`Delete column ${c}`}
                      onClick={(e) => {
                        e.stopPropagation()
                        if (!confirm(`Delete column “${c}”?`)) return
                        onDeleteExtraColumn?.(c)
                      }}
                    >
                      ×
                    </button>
                  </span>
                )
              )
            )}
            {!isHidden('type') ? th('type', 'Type') : null}
            {!isHidden('mac') ? th('mac', 'MAC') : null}
            {!isHidden('vendor') ? th('vendor', 'Vendor') : null}
            {!isHidden('lastChecked')
              ? th('lastChecked', label('lastChecked', 'Last checked'), {
                  sortable: true,
                  onClick: () => onSort('lastChecked')
                })
              : null}
            {!isHidden('actions') ? th('actions', '', { sortable: false }) : null}
          </tr>
        </thead>
        <tbody>
          {devices.length === 0 ? (
            <tr>
              <td colSpan={colCount} className="muted">
                No devices yet. Add one to begin monitoring.
              </td>
            </tr>
          ) : (
            grouped.flatMap((g) => {
              const rows: JSX.Element[] = []
              if (groupBy !== 'none') {
                rows.push(
                  <tr key={`group-${g.label}`} className="group-row">
                    <td colSpan={colCount} className="group-cell">
                      {g.label}
                    </td>
                  </tr>
                )
              }
              for (const d of g.devices) {
                rows.push(
                  <tr
                    key={d.id}
                    data-device-row={d.id}
                    className={
                      selectedEquipmentIds.has(d.id) ? 'device-row device-row--selected' : 'device-row'
                    }
                    onPointerDown={(e) => handleDeviceRowPointerDown(d, e)}
                    onClick={(e) => {
                      // After drag, skip blocks applyRowMouseSelection on the release click.
                      if (skipNextRowClickRef.current) {
                        skipNextRowClickRef.current = false
                        return
                      }
                      applyRowMouseSelection(d.id, e)
                    }}
                  >
                    {!isHidden('name') ? (
                      <td onMouseDown={(e) => e.stopPropagation()}>{renderEditableCell(d, 'name')}</td>
                    ) : null}
                    {!isHidden('status') ? (
                      <td>
                        <span
                          className={`status-dot ${statusClass(d.lastStatus)}`}
                          title={d.lastStatus}
                        />
                        {d.lastStatus}
                      </td>
                    ) : null}
                    {!isHidden('ip') ? (
                      <td onMouseDown={(e) => e.stopPropagation()}>{renderEditableCell(d, 'ip')}</td>
                    ) : null}
                    {!isHidden('subnet') ? (
                      <td onMouseDown={(e) => e.stopPropagation()}>{renderEditableCell(d, 'subnet')}</td>
                    ) : null}
                    {!isHidden('gateway') ? (
                      <td onMouseDown={(e) => e.stopPropagation()}>{renderEditableCell(d, 'gateway')}</td>
                    ) : null}
                    {visibleExtraColumns.map((c) => (
                      <td key={`${d.id}\u0000${c}`}>
                        {renderExtraColumnCell(d, c)}
                      </td>
                    ))}
                    {!isHidden('type') ? <td className="muted">{getDeviceTypeDisplayLabel(d)}</td> : null}
                    {!isHidden('mac') ? <td className="muted">{d.macAddress ?? '—'}</td> : null}
                    {!isHidden('vendor') ? <td className="muted">{d.vendor ?? '—'}</td> : null}
                    {!isHidden('lastChecked') ? <td className="muted">{formatTime(d.lastChecked)}</td> : null}
                    {!isHidden('actions') ? (
                      <td>
                        <button
                          type="button"
                          className="danger-icon"
                          title="Delete"
                          aria-label={`Delete ${d.name}`}
                          onClick={(e) => {
                            e.stopPropagation()
                            onDelete(d.id)
                          }}
                        >
                          ×
                        </button>
                      </td>
                    ) : null}
                  </tr>
                )
              }
              return rows
            })
          )}
        </tbody>
      </table>
    </div>
  )
}
