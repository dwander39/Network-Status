import type { ReactNode } from 'react'
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { Node } from '@xyflow/react'
import type { Device, DeviceGroup, MapLayoutBundle, NetworkInfo, SaveDevicePayload } from '@shared/types'
import { DEVICE_TYPE_CUSTOM_MAX_LEN, getDeviceTypeDisplayLabel } from '@shared/deviceTypeDisplay'
import {
  showDeviceTypeCustomField,
  validateDeviceFormFieldValues,
  type DeviceFormFieldValues
} from '@shared/deviceSaveValidation'
import type { MapAutoGroupMode } from './mapAutoLayout'
import {
  mapSelectionDeviceCount,
  mapSelectionGatewayCount,
  mapSelectionManualGroupCount,
  type MapSelection
} from './mapSelection'

/** Mirrors `MapView` `MapLayoutMode` without importing MapView (avoid circular deps). */
export type MapInspectorLayoutMode = 'manual' | MapAutoGroupMode

const AUTO_MODE_LABEL: Record<MapAutoGroupMode, string> = {
  vendor: 'Group by vendor',
  deviceType: 'Group by device type',
  subnet: 'Group by subnet'
}

function layoutModeTitle(mode: MapInspectorLayoutMode): string {
  return mode === 'manual' ? 'Manual layout' : AUTO_MODE_LABEL[mode]
}

function countDevicesInManualGroup(nodes: readonly Node[], groupId: string): number {
  return nodes.filter((n) => n.type === 'device' && n.parentId === groupId).length
}

function deviceMapGroupInfo(
  deviceId: string,
  bundle: MapLayoutBundle,
  nodes: readonly Node[]
): { manualGroupId: string | null; manualGroupName: string | null } {
  const dn = nodes.find((n) => n.id === deviceId && n.type === 'device')
  const fromParent = dn?.parentId && dn.parentId !== '' ? dn.parentId : null
  const fromBundle = bundle.positions[deviceId]?.manualGroupId ?? null
  const gid = fromParent ?? fromBundle
  if (!gid) return { manualGroupId: null, manualGroupName: null }
  const name = bundle.manualGroups.find((g) => g.id === gid)?.name ?? null
  return { manualGroupId: gid, manualGroupName: name }
}

export interface MapViewInspectorProps {
  layoutMode: MapInspectorLayoutMode
  mapSelection: MapSelection
  devices: Device[]
  savedBundle: MapLayoutBundle
  networkInfo: NetworkInfo | null
  networkId: string | null
  nodes: readonly Node[]
  /** Manual layout + connected network: group actions allowed */
  actionsEnabled: boolean
  onManualGroupAutoSize: (groupId: string) => void
  onManualGroupAutoAlign: (groupId: string) => void
  onManualGroupSetLock: (groupId: string, locked: boolean) => void
  /** Manual layout + connected network: rename via same path as on-map title edit (`renameMapManualGroup`). */
  onCommitManualGroupRename?: (groupId: string, name: string) => void
  /**
   * When the canvas keeps a locked manual group selected but the user clicked a child device,
   * inspect that device here without changing `mapSelection` (still manual-group).
   */
  inspectorPeekDeviceId?: string | null
  /** Device list groups (same as `DeviceForm`). */
  deviceGroups: DeviceGroup[]
  /** Persist device edits via `api.saveDevice` (same path as add/edit device). */
  onSaveDevice: (payload: SaveDevicePayload) => Promise<void>
}

function InspectorField({ label, children }: { label: string; children: ReactNode }): JSX.Element {
  return (
    <div className="map-inspector__field">
      <div className="map-inspector__label muted">{label}</div>
      <div className="map-inspector__value">{children}</div>
    </div>
  )
}

/** Inline rename for manual groups; mirrors `ManualGroupNode` keyboard/blur semantics. */
function ManualGroupInspectorName({
  groupId,
  name,
  onCommit
}: {
  groupId: string
  name: string
  onCommit: (groupId: string, trimmedName: string) => void
}): JSX.Element {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(name)
  const inputRef = useRef<HTMLInputElement>(null)
  const ignoreNextBlurRef = useRef(false)

  useEffect(() => {
    if (!editing) setDraft(name)
  }, [name, editing])

  useLayoutEffect(() => {
    if (!editing) return
    const el = inputRef.current
    if (!el) return
    el.focus()
    try {
      el.select()
    } catch {
      /* ignore */
    }
  }, [editing])

  const cancelEdit = useCallback(() => {
    setDraft(name)
    setEditing(false)
  }, [name])

  const applyIfChanged = useCallback(() => {
    const next = draft.trim()
    if (!next) {
      cancelEdit()
      return
    }
    if (next === name.trim()) {
      setEditing(false)
      return
    }
    setEditing(false)
    onCommit(groupId, next)
  }, [cancelEdit, draft, groupId, name, onCommit])

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Enter') {
        e.preventDefault()
        ignoreNextBlurRef.current = true
        applyIfChanged()
      }
      if (e.key === 'Escape') {
        e.preventDefault()
        ignoreNextBlurRef.current = true
        cancelEdit()
      }
    },
    [applyIfChanged, cancelEdit]
  )

  return editing ? (
    <input
      ref={inputRef}
      type="text"
      className="map-inspector__value-input"
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onMouseDown={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
      onKeyDown={onKeyDown}
      onBlur={() => {
        if (ignoreNextBlurRef.current) {
          ignoreNextBlurRef.current = false
          return
        }
        applyIfChanged()
      }}
      aria-label="Manual group name"
    />
  ) : (
    <button
      type="button"
      className="map-inspector__value-btn"
      title="Click to edit name"
      onMouseDown={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => {
        e.stopPropagation()
        setEditing(true)
        setDraft(name)
      }}
    >
      {name}
    </button>
  )
}

type DeviceValuePatch = Partial<{
  name: string
  ip: string
  subnet: string
  gateway: string
  deviceTypeCustom: string
  groupId: string | null
}>

function mergeDeviceFieldValues(d: Device, patch: DeviceValuePatch): DeviceFormFieldValues {
  return {
    name: patch.name ?? d.name,
    ip: patch.ip ?? d.ip,
    subnet: patch.subnet ?? d.subnet,
    gateway: patch.gateway ?? d.gateway,
    deviceTypeCustom:
      patch.deviceTypeCustom !== undefined ? patch.deviceTypeCustom : (d.deviceTypeCustom ?? '')
  }
}

function buildSavePayloadFromDevice(
  d: Device,
  values: DeviceFormFieldValues,
  groupId: string | null,
  showCustom: boolean
): SaveDevicePayload {
  const payload: SaveDevicePayload = {
    id: d.id,
    name: values.name.trim(),
    ip: values.ip.trim(),
    subnet: values.subnet.trim(),
    gateway: values.gateway.trim(),
    groupId
  }
  if (showCustom) {
    payload.deviceTypeCustom = values.deviceTypeCustom.trim() || null
  }
  return payload
}

/** Inline text: Enter save, Escape cancel, blur save if valid/changed (async `saveDevice`). */
function InspectorDeviceInlineTextField({
  value,
  ariaLabel,
  onCommit,
  maxLength
}: {
  value: string
  ariaLabel: string
  onCommit: (raw: string) => Promise<boolean>
  maxLength?: number
}): JSX.Element {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(value)
  const inputRef = useRef<HTMLInputElement>(null)
  const ignoreNextBlurRef = useRef(false)

  useEffect(() => {
    if (!editing) setDraft(value)
  }, [value, editing])

  useLayoutEffect(() => {
    if (!editing) return
    const el = inputRef.current
    if (!el) return
    el.focus()
    try {
      el.select()
    } catch {
      /* ignore */
    }
  }, [editing])

  const cancelEdit = useCallback(() => {
    setDraft(value)
    setEditing(false)
  }, [value])

  const applyIfChanged = useCallback(async () => {
    if (draft === value) {
      setEditing(false)
      return
    }
    const ok = await onCommit(draft)
    if (ok) setEditing(false)
    else {
      setDraft(value)
      setEditing(false)
    }
  }, [draft, value, onCommit])

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Enter') {
        e.preventDefault()
        ignoreNextBlurRef.current = true
        void applyIfChanged()
      }
      if (e.key === 'Escape') {
        e.preventDefault()
        e.stopPropagation()
        ignoreNextBlurRef.current = true
        cancelEdit()
      }
    },
    [applyIfChanged, cancelEdit]
  )

  return editing ? (
    <input
      ref={inputRef}
      type="text"
      className="map-inspector__value-input"
      value={draft}
      maxLength={maxLength}
      onChange={(e) => setDraft(e.target.value)}
      onMouseDown={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
      onKeyDown={onKeyDown}
      onBlur={() => {
        if (ignoreNextBlurRef.current) {
          ignoreNextBlurRef.current = false
          return
        }
        void applyIfChanged()
      }}
      aria-label={ariaLabel}
    />
  ) : (
    <button
      type="button"
      className="map-inspector__value-btn"
      title="Click to edit"
      onMouseDown={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => {
        e.stopPropagation()
        setEditing(true)
        setDraft(value)
      }}
    >
      {value || '—'}
    </button>
  )
}

/** Same options as `DeviceForm` group `<select>`; change commits immediately (avoids select blur/onChange races). */
function InspectorDeviceGroupField({
  device,
  groups,
  onCommit
}: {
  device: Device
  groups: DeviceGroup[]
  onCommit: (patch: DeviceValuePatch) => Promise<boolean>
}): JSX.Element {
  return (
    <select
      className="map-inspector__value-select"
      value={device.groupId ?? ''}
      aria-label="Device list group"
      title="Device list group (same as Edit device)"
      onMouseDown={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
      onChange={(e) => {
        void (async () => {
          const gid = e.target.value === '' ? null : e.target.value
          if (gid === (device.groupId ?? null)) return
          await onCommit({ groupId: gid })
        })()
      }}
    >
      <option value="">— None —</option>
      {groups.map((g) => (
        <option key={g.id} value={g.id}>
          {g.name}
        </option>
      ))}
    </select>
  )
}

function StaticDeviceInspectorRows({
  d,
  manual,
  manualGroupId,
  manualGroupName
}: {
  d: Device
  manual: boolean
  manualGroupId: string | null
  manualGroupName: string | null
}): JSX.Element {
  const showCustom = showDeviceTypeCustomField(d)
  return (
    <>
      <InspectorField label="Name">{d.name}</InspectorField>
      <InspectorField label="IP">{d.ip}</InspectorField>
      <InspectorField label="Subnet">{d.subnet || '—'}</InspectorField>
      <InspectorField label="Gateway">{d.gateway || '—'}</InspectorField>
      <InspectorField label="Group">{d.groupName?.trim() ? d.groupName : '—'}</InspectorField>
      <InspectorField label="Type">{getDeviceTypeDisplayLabel(d)}</InspectorField>
      {showCustom ? (
        <InspectorField label="Custom type">{d.deviceTypeCustom?.trim() ? d.deviceTypeCustom : '—'}</InspectorField>
      ) : null}
      <InspectorField label="Vendor">{d.vendor?.trim() ? d.vendor : '—'}</InspectorField>
      <InspectorField label="Map group">
        {manual && manualGroupId ? manualGroupName ?? manualGroupId : '—'}
      </InspectorField>
    </>
  )
}

function MapSingleDeviceInspectorFields({
  d,
  manual,
  manualGroupId,
  manualGroupName,
  editable,
  groups,
  onSaveDevice
}: {
  d: Device
  manual: boolean
  manualGroupId: string | null
  manualGroupName: string | null
  editable: boolean
  groups: DeviceGroup[]
  onSaveDevice: (payload: SaveDevicePayload) => Promise<void>
}): JSX.Element {
  const showCustom = showDeviceTypeCustomField(d)
  const [saveError, setSaveError] = useState<string | null>(null)

  useEffect(() => {
    setSaveError(null)
  }, [d.id])

  const commitPatch = useCallback(
    async (patch: DeviceValuePatch) => {
      const values = mergeDeviceFieldValues(d, patch)
      const groupId = patch.groupId !== undefined ? patch.groupId : d.groupId ?? null
      const err = validateDeviceFormFieldValues(values, showCustom)
      if (err) {
        setSaveError(err)
        return false
      }
      try {
        await onSaveDevice(buildSavePayloadFromDevice(d, values, groupId, showCustom))
        setSaveError(null)
        return true
      } catch (e) {
        setSaveError(e instanceof Error ? e.message : 'Save failed.')
        return false
      }
    },
    [d, showCustom, onSaveDevice]
  )

  if (!editable) {
    return (
      <div className="map-inspector__fields">
        <StaticDeviceInspectorRows
          d={d}
          manual={manual}
          manualGroupId={manualGroupId}
          manualGroupName={manualGroupName}
        />
      </div>
    )
  }

  return (
    <>
      <div className="map-inspector__fields">
        <InspectorField label="Name">
          <InspectorDeviceInlineTextField
            value={d.name}
            ariaLabel="Device name"
            onCommit={(raw) => commitPatch({ name: raw })}
          />
        </InspectorField>
        <InspectorField label="IP">
          <InspectorDeviceInlineTextField
            value={d.ip}
            ariaLabel="Device IP address"
            onCommit={(raw) => commitPatch({ ip: raw })}
          />
        </InspectorField>
        <InspectorField label="Subnet mask">
          <InspectorDeviceInlineTextField
            value={d.subnet}
            ariaLabel="Subnet mask"
            onCommit={(raw) => commitPatch({ subnet: raw })}
          />
        </InspectorField>
        <InspectorField label="Gateway">
          <InspectorDeviceInlineTextField
            value={d.gateway}
            ariaLabel="Gateway"
            onCommit={(raw) => commitPatch({ gateway: raw })}
          />
        </InspectorField>
        <InspectorField label="Group">
          <InspectorDeviceGroupField device={d} groups={groups} onCommit={commitPatch} />
        </InspectorField>
        <InspectorField label="Type">
          <span className="map-inspector__value-readonly">{getDeviceTypeDisplayLabel(d)}</span>
        </InspectorField>
        {showCustom ? (
          <InspectorField label="Custom type (optional)">
            <InspectorDeviceInlineTextField
              value={d.deviceTypeCustom ?? ''}
              ariaLabel="Custom device type"
              maxLength={DEVICE_TYPE_CUSTOM_MAX_LEN}
              onCommit={(raw) => commitPatch({ deviceTypeCustom: raw })}
            />
          </InspectorField>
        ) : null}
        <InspectorField label="Vendor">
          <span className="map-inspector__value-readonly">{d.vendor?.trim() ? d.vendor : '—'}</span>
        </InspectorField>
        <InspectorField label="Map group">
          <span className="map-inspector__value-readonly">
            {manual && manualGroupId ? manualGroupName ?? manualGroupId : '—'}
          </span>
        </InspectorField>
      </div>
      {saveError ? <p className="error map-inspector__save-error">{saveError}</p> : null}
    </>
  )
}

export function MapViewInspector({
  layoutMode,
  mapSelection,
  devices,
  savedBundle,
  networkInfo,
  networkId,
  nodes,
  actionsEnabled,
  onManualGroupAutoSize,
  onManualGroupAutoAlign,
  onManualGroupSetLock,
  onCommitManualGroupRename,
  inspectorPeekDeviceId = null,
  deviceGroups,
  onSaveDevice
}: MapViewInspectorProps): JSX.Element | null {
  const manual = layoutMode === 'manual'
  const readOnlyView = !manual
  const deviceById = new Map(devices.map((d) => [d.id, d]))
  const deviceInspectorEditable = actionsEnabled

  /** Locked-group child click: map selection stays manual-group; inspector shows the device if peek is valid. */
  let lockedGroupChildPeekId: string | null = null
  if (manual && mapSelection.kind === 'manual-group' && inspectorPeekDeviceId != null) {
    const gid = mapSelection.groupId
    const g = savedBundle.manualGroups.find((x) => x.id === gid)
    if (g != null && Boolean(g.contentsLocked ?? true)) {
      const n = nodes.find((x) => x.id === inspectorPeekDeviceId && x.type === 'device')
      if (n && n.parentId === gid) lockedGroupChildPeekId = inspectorPeekDeviceId
    }
  }

  const modeBanner = (
    <div className={`map-inspector__mode ${readOnlyView ? 'map-inspector__mode--readonly' : ''}`}>
      <span className="map-inspector__mode-name">{layoutModeTitle(layoutMode)}</span>
      <span className="muted map-inspector__mode-meta">
        {readOnlyView ? 'Computed view · not saved to manual map' : 'Editable · positions & groups persist'}
      </span>
    </div>
  )

  if (mapSelection.kind === 'none') {
    return (
      <div className="map-inspector">
        <h3 className="map-inspector__title">Map</h3>
        {modeBanner}
        <p className="map-inspector__empty-lead muted">Nothing selected</p>
        {networkInfo ? (
          <div className="map-inspector__fields">
            <InspectorField label="Network">{networkInfo.profileName ?? networkInfo.cidr}</InspectorField>
            <InspectorField label="Gateway">{networkInfo.gateway}</InspectorField>
            <InspectorField label="Subnet (CIDR)">{networkInfo.cidr}</InspectorField>
          </div>
        ) : networkId ? (
          <p className="muted map-inspector__hint">Network: {networkId}</p>
        ) : (
          <p className="muted map-inspector__hint">Connect to a network to save map layout.</p>
        )}
        <p className="map-inspector__hint muted">
          {manual
            ? 'Click a device, group, or gateway. Drag on empty space to marquee-select. Shift+marquee adds to the selection.'
            : 'Click an auto-group header or device to inspect. Pan the canvas to explore; layout is read-only.'}
        </p>
        <p className="map-inspector__hint muted">{devices.length} device{devices.length === 1 ? '' : 's'} on map</p>
      </div>
    )
  }

  if (lockedGroupChildPeekId != null) {
    const d = deviceById.get(lockedGroupChildPeekId)
    const { manualGroupId, manualGroupName } = deviceMapGroupInfo(lockedGroupChildPeekId, savedBundle, nodes)
    return (
      <div className="map-inspector">
        <h3 className="map-inspector__title">Device</h3>
        {modeBanner}
        <p className="map-inspector__hint muted map-inspector__peek-banner">
          Canvas selection is the parent group (locked). This device is not individually selected on the map.
        </p>
        {!d ? (
          <p className="muted">This device is no longer in the list.</p>
        ) : (
          <div className="map-inspector__fields">
            <StaticDeviceInspectorRows
              d={d}
              manual={manual}
              manualGroupId={manualGroupId}
              manualGroupName={manualGroupName}
            />
          </div>
        )}
      </div>
    )
  }

  if (mapSelection.kind === 'device') {
    const d = deviceById.get(mapSelection.deviceId)
    const { manualGroupId, manualGroupName } = deviceMapGroupInfo(mapSelection.deviceId, savedBundle, nodes)
    return (
      <div className="map-inspector">
        <h3 className="map-inspector__title">Device</h3>
        {modeBanner}
        {!d ? (
          <p className="muted">This device is no longer in the list.</p>
        ) : (
          <MapSingleDeviceInspectorFields
            d={d}
            manual={manual}
            manualGroupId={manualGroupId}
            manualGroupName={manualGroupName}
            editable={deviceInspectorEditable}
            groups={deviceGroups}
            onSaveDevice={onSaveDevice}
          />
        )}
        {readOnlyView ? (
          <p className="map-inspector__hint muted">Device positions in this view are computed, not edited here.</p>
        ) : null}
      </div>
    )
  }

  if (mapSelection.kind === 'gateway') {
    const gwIp = networkInfo?.gateway ?? '—'
    return (
      <div className="map-inspector">
        <h3 className="map-inspector__title">Gateway</h3>
        {modeBanner}
        <div className="map-inspector__fields">
          <InspectorField label="Label">Gateway</InspectorField>
          <InspectorField label="IP">{gwIp}</InspectorField>
          {networkInfo ? (
            <>
              <InspectorField label="Subnet (CIDR)">{networkInfo.cidr}</InspectorField>
              <InspectorField label="Local IPv4">{networkInfo.localIpv4}</InspectorField>
              {networkInfo.profileName ? (
                <InspectorField label="Profile">{networkInfo.profileName}</InspectorField>
              ) : null}
            </>
          ) : null}
        </div>
      </div>
    )
  }

  if (mapSelection.kind === 'manual-group') {
    const g = savedBundle.manualGroups.find((x) => x.id === mapSelection.groupId)
    const gn = nodes.find((n) => n.id === mapSelection.groupId && n.type === 'manualGroup')
    const data = gn?.data as { name?: string; width?: number; height?: number; contentsLocked?: boolean } | undefined
    const name = g?.name ?? data?.name ?? 'Group'
    const locked = Boolean(g?.contentsLocked ?? data?.contentsLocked ?? true)
    const w = g?.width ?? data?.width
    const h = g?.height ?? data?.height
    const memberCount = countDevicesInManualGroup(nodes, mapSelection.groupId)
    const gid = mapSelection.groupId

    return (
      <div className="map-inspector">
        <h3 className="map-inspector__title">Manual group</h3>
        {modeBanner}
        {!g && !gn ? (
          <p className="muted">Group not found in saved layout.</p>
        ) : (
          <>
            <div className="map-inspector__fields">
              <InspectorField label="Name">
                {onCommitManualGroupRename ? (
                  <ManualGroupInspectorName groupId={gid} name={name} onCommit={onCommitManualGroupRename} />
                ) : (
                  name
                )}
              </InspectorField>
              <InspectorField label="Contents">{locked ? 'Locked' : 'Unlocked'}</InspectorField>
              <InspectorField label="Devices in group">{memberCount}</InspectorField>
              <InspectorField label="Size">
                {typeof w === 'number' && typeof h === 'number' && Number.isFinite(w) && Number.isFinite(h)
                  ? `${Math.round(w)} × ${Math.round(h)} px`
                  : '—'}
              </InspectorField>
            </div>
            {actionsEnabled ? (
              <div className="map-inspector__actions">
                <button
                  type="button"
                  className="secondary"
                  onClick={() => onManualGroupSetLock(gid, !locked)}
                >
                  {locked ? 'Unlock group' : 'Lock group'}
                </button>
                <button type="button" className="secondary" onClick={() => onManualGroupAutoSize(gid)}>
                  Auto size
                </button>
                <button type="button" className="secondary" onClick={() => onManualGroupAutoAlign(gid)}>
                  Auto align
                </button>
              </div>
            ) : (
              <p className="map-inspector__hint muted">Switch to Manual layout with a saved network to use group actions.</p>
            )}
          </>
        )}
      </div>
    )
  }

  if (mapSelection.kind === 'auto-group') {
    const modeLabel = AUTO_MODE_LABEL[mapSelection.autoGroupBy]
    return (
      <div className="map-inspector">
        <h3 className="map-inspector__title">Auto group</h3>
        {modeBanner}
        <div className="map-inspector__fields">
          <InspectorField label="Bucket">{mapSelection.groupKey}</InspectorField>
          <InspectorField label="Group by">{modeLabel}</InspectorField>
        </div>
        <p className="map-inspector__hint muted">
          This grouping is computed for viewing only. It is not stored as manual map structure.
        </p>
      </div>
    )
  }

  if (mapSelection.kind === 'multi') {
    const dc = mapSelectionDeviceCount(mapSelection)
    const gc = mapSelectionManualGroupCount(mapSelection)
    const gwc = mapSelectionGatewayCount(mapSelection)
    const parts: string[] = []
    if (gwc > 0) parts.push('Gateway')
    if (gc > 0) parts.push(`${gc} group${gc === 1 ? '' : 's'}`)
    if (dc > 0) parts.push(`${dc} device${dc === 1 ? '' : 's'}`)
    const total = dc + gc + gwc
    return (
      <div className="map-inspector">
        <h3 className="map-inspector__title">Multiple selection</h3>
        {modeBanner}
        <p className="map-inspector__multi-summary">
          <strong>{total}</strong> item{total === 1 ? '' : 's'} selected
        </p>
        <ul className="map-inspector__multi-list muted">
          {parts.map((p) => (
            <li key={p}>{p}</li>
          ))}
        </ul>
        {readOnlyView ? (
          <p className="map-inspector__hint muted">Bulk editing is not available in computed layout modes.</p>
        ) : (
          <p className="map-inspector__hint muted">Bulk actions are not available yet; adjust items one at a time.</p>
        )}
      </div>
    )
  }

  return null
}
