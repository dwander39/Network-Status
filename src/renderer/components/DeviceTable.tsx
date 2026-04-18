import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { getDeviceTypeDisplayLabel } from '@shared/deviceTypeDisplay'
import type { Device, DeviceGroup, DeviceStatus, SaveDevicePayload } from '@shared/types'
import { isValidIPv4 } from '@shared/ipValidation'

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
  selectedDeviceId?: string | null
  onSelectDevice?: (id: string) => void
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
  onFocusNameEditHandled,
  selectedDeviceId,
  onSelectDevice
}: Props): JSX.Element {
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
          onClick={() => startEditCell(d, field)}
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
            e.stopPropagation()
            setEditing(null)
            setDraft('')
            setEditingExtra({ id: d.id, col })
            setDraftExtra(v)
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

  return (
    <div className="table-wrap">
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
                    className={selectedDeviceId === d.id ? 'device-row device-row--selected' : 'device-row'}
                    onClick={() => onSelectDevice?.(d.id)}
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
                      <td
                        key={`${d.id}\u0000${c}`}
                        onMouseDown={(e) => e.stopPropagation()}
                        onClick={(e) => e.stopPropagation()}
                      >
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
