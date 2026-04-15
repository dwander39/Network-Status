import { useMemo, useState } from 'react'
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
  onSaveDevice
}: Props): JSX.Element {
  const [editing, setEditing] = useState<{ id: string; field: EditableField } | null>(null)
  const [draft, setDraft] = useState('')
  const [saving, setSaving] = useState(false)

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

  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th onClick={() => onSort('name')}>{label('name', 'Name')}</th>
            <th onClick={() => onSort('group')}>{label('group', 'Group')}</th>
            <th onClick={() => onSort('status')}>{label('status', 'Status')}</th>
            <th>IP</th>
            <th>Subnet</th>
            <th>Gateway</th>
            <th>Type</th>
            <th>MAC</th>
            <th>Vendor</th>
            <th onClick={() => onSort('lastChecked')}>{label('lastChecked', 'Last checked')}</th>
            <th className="th-actions" />
          </tr>
        </thead>
        <tbody>
          {devices.length === 0 ? (
            <tr>
              <td colSpan={11} className="muted">
                No devices yet. Add one to begin monitoring.
              </td>
            </tr>
          ) : (
            grouped.flatMap((g) => {
              const rows: JSX.Element[] = []
              if (groupBy !== 'none') {
                rows.push(
                  <tr key={`group-${g.label}`} className="group-row">
                    <td colSpan={11} className="group-cell">
                      {g.label}
                    </td>
                  </tr>
                )
              }
              for (const d of g.devices) {
                rows.push(
                  <tr key={d.id}>
                    <td onMouseDown={(e) => e.stopPropagation()}>{renderEditableCell(d, 'name')}</td>
                    <td onMouseDown={(e) => e.stopPropagation()}>
                      <select
                        className="table-select"
                        aria-label={`Group for ${d.name}`}
                        value={d.groupId ?? ''}
                        onChange={(e) => {
                          const v = e.target.value
                          void onSetDeviceGroup(d.id, v === '' ? null : v)
                        }}
                      >
                        <option value="">— None —</option>
                        {groups.map((gg) => (
                          <option key={gg.id} value={gg.id}>
                            {gg.name}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td>
                      <span
                        className={`status-dot ${statusClass(d.lastStatus)}`}
                        title={d.lastStatus}
                      />
                      {d.lastStatus}
                    </td>
                    <td onMouseDown={(e) => e.stopPropagation()}>{renderEditableCell(d, 'ip')}</td>
                    <td onMouseDown={(e) => e.stopPropagation()}>{renderEditableCell(d, 'subnet')}</td>
                    <td onMouseDown={(e) => e.stopPropagation()}>{renderEditableCell(d, 'gateway')}</td>
                    <td className="muted">{getDeviceTypeDisplayLabel(d)}</td>
                    <td className="muted">{d.macAddress ?? '—'}</td>
                    <td className="muted">{d.vendor ?? '—'}</td>
                    <td className="muted">{formatTime(d.lastChecked)}</td>
                    <td>
                      <button
                        type="button"
                        className="danger-icon"
                        title="Delete"
                        aria-label={`Delete ${d.name}`}
                        onClick={() => onDelete(d.id)}
                      >
                        ×
                      </button>
                    </td>
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
