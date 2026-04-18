import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type {
  AppSettings,
  ArpEntry,
  Device,
  DeviceGroup,
  NetworkInfo,
  NetworkProfileListItem,
  SaveDevicePayload
} from '@shared/types'
import { useConfirmAction } from './confirm/ConfirmDialogContext'
import {
  logDeleteFlowPreDelete,
  recoverKeyboardAfterDestructiveAction
} from './utils/postDeleteFocusRecovery'
import { DeviceForm } from './components/DeviceForm'
import { NetworkProfilePanel } from './components/NetworkProfilePanel'
import { DeviceTable, type GroupByMode, type SortKey } from './components/DeviceTable'
import { DiscoveredPanel } from './components/DiscoveredPanel'
import { SettingsModal } from './components/SettingsModal'
import { NewNetworkDetectedModal } from './components/NewNetworkDetectedModal'
import { EventLogPanel } from './components/EventLogPanel'

const MapView = lazy(async () => {
  const m = await import('./components/MapView')
  return { default: m.MapView }
})

type FilterMode = 'all' | 'online' | 'offline'
type MainViewMode = 'list' | 'map'

function sortDevices(
  list: Device[],
  key: SortKey,
  dir: 'asc' | 'desc'
): Device[] {
  const mul = dir === 'asc' ? 1 : -1
  const copy = [...list]
  copy.sort((a, b) => {
    if (key === 'name') return a.name.localeCompare(b.name) * mul
    if (key === 'group') {
      const ga = (a.groupName ?? '').toLowerCase()
      const gb = (b.groupName ?? '').toLowerCase()
      if (ga !== gb) return ga.localeCompare(gb) * mul
      return a.name.localeCompare(b.name) * mul
    }
    if (key === 'status') {
      const o = { online: 0, offline: 1, unknown: 2 }
      return (o[a.lastStatus] - o[b.lastStatus]) * mul
    }
    const ta = a.lastChecked ? new Date(a.lastChecked).getTime() : 0
    const tb = b.lastChecked ? new Date(b.lastChecked).getTime() : 0
    return (ta - tb) * mul
  })
  return copy
}

export function App(): JSX.Element {
  const { confirmAction } = useConfirmAction()
  const api = window.ssApi
  const isMapWindow = window.location.hash === '#map-window'
  const [devices, setDevices] = useState<Device[]>([])
  const [groups, setGroups] = useState<DeviceGroup[]>([])
  const [discovered, setDiscovered] = useState<ArpEntry[]>([])
  const [settings, setSettings] = useState<AppSettings | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [filter, setFilter] = useState<FilterMode>('all')
  const [groupBy, setGroupBy] = useState<GroupByMode>('none')
  const [sortKey, setSortKey] = useState<SortKey>('name')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc')
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [formDevice, setFormDevice] = useState<Device | null | 'new'>(null)
  const [formPrefill, setFormPrefill] = useState<
    Partial<Pick<SaveDevicePayload, 'name' | 'ip' | 'subnet' | 'gateway'>> | null
  >(null)
  /** Remount DeviceForm on each open so IPC re-renders don’t reset fields via effect deps. */
  const [formModalKey, setFormModalKey] = useState(0)
  const [networkInfo, setNetworkInfo] = useState<NetworkInfo | null>(null)
  const [networkSwitchMessage, setNetworkSwitchMessage] = useState<string | null>(null)
  const [profiles, setProfiles] = useState<NetworkProfileListItem[]>([])
  /** Which saved network the user is currently viewing in the dropdown. */
  const [viewingProfile, setViewingProfile] = useState<NetworkProfileListItem | null>(null)
  const [newNetwork, setNewNetwork] = useState<import('@shared/types').NewNetworkDetectedPayload | null>(null)
  const [mainView, setMainView] = useState<MainViewMode>('list')
  const [focusNameEditDeviceId, setFocusNameEditDeviceId] = useState<string | null>(null)
  const [selectedDeviceId, setSelectedDeviceId] = useState<string | null>(null)
  const [addMultipleOpen, setAddMultipleOpen] = useState(false)
  const [addMultipleCount, setAddMultipleCount] = useState('3')
  const [extraColumns, setExtraColumns] = useState<string[]>([])
  const [extraColumnValues, setExtraColumnValues] = useState<Record<string, Record<string, string>>>({})
  const [columnWidthsPx, setColumnWidthsPx] = useState<Record<string, number>>({})
  const [hiddenColumns, setHiddenColumns] = useState<Record<string, boolean>>({})
  const [columnsPanelOpen, setColumnsPanelOpen] = useState(false)
  const [inspectorDraft, setInspectorDraft] = useState<Pick<SaveDevicePayload, 'name' | 'ip' | 'subnet' | 'gateway'>>({
    name: '',
    ip: '',
    subnet: '',
    gateway: ''
  })
  const [inspectorSaving, setInspectorSaving] = useState(false)

  const viewingHistoricalProfile = viewingProfile != null && viewingProfile.isActive === false
  const savedIps = useMemo(() => new Set(devices.map((d) => d.ip)), [devices])
  const viewingProfileRef = useRef<NetworkProfileListItem | null>(null)

  const onProfilesUpdated = useCallback((list: NetworkProfileListItem[]) => {
    setProfiles(list)
  }, [])

  const onFocusNameEditHandled = useCallback(() => {
    setFocusNameEditDeviceId(null)
  }, [])

  const load = useCallback(async () => {
    setLoadError(null)
    const [d, arp, s, g, n, prof] = await Promise.all([
      api.getDevices(),
      api.getArp(),
      api.getSettings(),
      api.getDeviceGroups(),
      api.getNetworkInfo(),
      api.getNetworkProfiles()
    ])
    setDevices(d)
    setGroups(g)
    setDiscovered(arp.discovered)
    setSettings(s)
    setNetworkInfo(n)
    setProfiles(prof)
  }, [api])

  useEffect(() => {
    if (!window.ssApi) {
      setLoadError(
        'Preload did not expose window.ssApi. Run the app with npm run dev (or use a fresh npm run build output), not raw electron on stale files.'
      )
      return
    }
    void load().catch((err: unknown) => {
      setLoadError(err instanceof Error ? err.message : String(err))
    })
    const unsubD = api.onDevicesChanged((next) => {
      const vp = viewingProfileRef.current
      if (vp && vp.isActive === false) {
        // When browsing a historical saved network, ignore live pushes and keep showing that profile's rows.
        void api.getDevices(vp.networkId).then(setDevices)
      } else {
        setDevices(next)
      }
    })
    const unsubA = api.onArpChanged((p) => {
      setDiscovered(p.discovered)
    })
    const unsubS = api.onSettingsChanged(setSettings)
    const unsubG = api.onDeviceGroupsChanged(setGroups)
    const unsubShow = api.onShowSettings(() => setSettingsOpen(true))
    const unsubNet = api.onNetworkChanged((info) => {
      setNetworkInfo(info)
      setNetworkSwitchMessage('Network changed. Refreshing devices…')
      window.setTimeout(() => setNetworkSwitchMessage(null), 4000)
    })
    const unsubNetInfo = api.onNetworkInfoUpdated(setNetworkInfo)
    const unsubProfiles = api.onNetworkProfilesChanged(setProfiles)
    const unsubNewNet = api.onNewNetworkDetected((p) => setNewNetwork(p))
    return () => {
      unsubD()
      unsubA()
      unsubS()
      unsubG()
      unsubShow()
      unsubNet()
      unsubNetInfo()
      unsubProfiles()
      unsubNewNet()
    }
  }, [api, load])

  useEffect(() => {
    viewingProfileRef.current = viewingProfile
  }, [viewingProfile])

  // When the user changes the "Saved networks" dropdown, reload devices for that saved network.
  useEffect(() => {
    if (!window.ssApi) return
    if (!viewingProfile) return
    void api.getDevices(viewingProfile.networkId).then(setDevices)
  }, [api, viewingProfile?.id, viewingProfile?.networkId])

  const filtered = useMemo(() => {
    // When browsing a non-active saved network, we are not actively monitoring that LAN.
    // Show the device rows, but avoid implying they are currently reachable ("online").
    const base = viewingHistoricalProfile
      ? devices.map((d) => ({ ...d, lastStatus: 'unknown' as const, lastChecked: null }))
      : devices
    let list = base
    if (filter === 'online') list = list.filter((x) => x.lastStatus === 'online')
    if (filter === 'offline') list = list.filter((x) => x.lastStatus === 'offline')
    return sortDevices(list, sortKey, sortDir)
  }, [devices, viewingHistoricalProfile, filter, sortKey, sortDir])

  const selectedDevice = useMemo(() => {
    if (!selectedDeviceId) return null
    return devices.find((d) => d.id === selectedDeviceId) ?? null
  }, [devices, selectedDeviceId])

  useEffect(() => {
    if (!selectedDevice) return
    setInspectorDraft({
      name: selectedDevice.name,
      ip: selectedDevice.ip,
      subnet: selectedDevice.subnet,
      gateway: selectedDevice.gateway
    })
  }, [selectedDevice?.id, selectedDevice?.name, selectedDevice?.ip, selectedDevice?.subnet, selectedDevice?.gateway])

  if (loadError) {
    return (
      <div className="app">
        <h1>Could not start</h1>
        <p className="error">{loadError}</p>
        <p className="muted">Open DevTools (F12) → Console for details. See TEST-TODO.md step 1.</p>
      </div>
    )
  }

  function toggleSort(k: SortKey): void {
    if (sortKey === k) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
    else {
      setSortKey(k)
      setSortDir('asc')
    }
  }

  async function handleDelete(id: string): Promise<void> {
    const ok = await confirmAction({
      title: 'Delete device?',
      message: 'This removes the device from the monitored list. This action cannot be undone.',
      confirmLabel: 'Delete',
      cancelLabel: 'Cancel',
      destructive: true
    })
    if (!ok) return
    logDeleteFlowPreDelete('app:deleteDevice')
    await api.deleteDevice(id)
    recoverKeyboardAfterDestructiveAction('app:deleteDevice')
  }

  if (!settings) {
    return <div className="app muted">Loading…</div>
  }

  if (isMapWindow) {
    return (
      <div className="app app--map-view">
        <Suspense fallback={<p className="muted">Loading map…</p>}>
          <MapView
            devices={filtered}
            networkInfo={networkInfo}
            deviceGroups={groups}
            onSaveDevice={async (payload) => {
              await api.saveDevice(payload)
            }}
          />
        </Suspense>
      </div>
    )
  }

  return (
    <div
      className={`app${mainView === 'map' ? ' app--map-view' : ''}${
        mainView === 'list' ? ' app--list-view' : ''
      }`}
    >
      <h1>Network devices</h1>

      <nav className="settings-submenu view-mode-nav" aria-label="Main view">
        <button
          type="button"
          className={
            mainView === 'list' ? 'settings-submenu__tab settings-submenu__tab--active' : 'settings-submenu__tab'
          }
          aria-current={mainView === 'list' ? 'page' : undefined}
          onClick={() => setMainView('list')}
        >
          List view
        </button>
        <button
          type="button"
          className={
            mainView === 'map' ? 'settings-submenu__tab settings-submenu__tab--active' : 'settings-submenu__tab'
          }
          aria-current={mainView === 'map' ? 'page' : undefined}
          onClick={() => {
            void api.focusMapViewWindowIfOpen().then((focused) => {
              if (focused) return
              setMainView('map')
            })
          }}
        >
          Map view
        </button>
      </nav>

      {networkInfo ? (
        <div
          className={`banner banner-muted${networkInfo.profileName ? ' banner-current-profile' : ''}`}
        >
          <span className="network-profile-title">
            {networkInfo.profileName ? (
              <>
                <strong>{networkInfo.profileName}</strong>
                <span className="muted"> — current network</span>
              </>
            ) : (
              <strong>Current network</strong>
            )}
          </span>
          <div className="network-profile-banner-detail">
            {networkInfo.cidr} — gateway {networkInfo.gateway}, this host {networkInfo.localIpv4}
            {networkInfo.profileLastSeen ? (
              <span className="muted"> — last seen {new Date(networkInfo.profileLastSeen).toLocaleString()}</span>
            ) : null}
          </div>
        </div>
      ) : null}
      {networkSwitchMessage ? (
        <div className="banner banner-warn">{networkSwitchMessage}</div>
      ) : null}

      {mainView === 'map' ? (
        <div className="toolbar">
          <button
            type="button"
            onClick={() => {
              void (async () => {
                try {
                  for (let attempt = 0; attempt < 16; attempt++) {
                    const b = new Uint8Array(1)
                    crypto.getRandomValues(b)
                    const ip = `203.0.113.${2 + (b[0] % 253)}`
                    try {
                      const created = await api.saveDevice({
                        name: 'New device',
                        ip,
                        subnet: '',
                        gateway: ''
                      })
                      setFocusNameEditDeviceId(created.id)
                      return
                    } catch (e) {
                      const msg = e instanceof Error ? e.message : String(e)
                      if (msg.includes('already')) continue
                      throw e
                    }
                  }
                  throw new Error('Could not add device')
                } catch (e) {
                  alert(e instanceof Error ? e.message : 'Could not add device')
                }
              })()
            }}
          >
            Add device
          </button>
          <button type="button" onClick={() => void api.openMapViewWindow()}>
            Open Map View Window
          </button>
          <label>
            Filter
            <select value={filter} onChange={(e) => setFilter(e.target.value as FilterMode)}>
              <option value="all">All</option>
              <option value="online">Online only</option>
              <option value="offline">Offline only</option>
            </select>
          </label>
        </div>
      ) : null}

      {mainView === 'list' && columnsPanelOpen ? (
        <div className="banner banner-muted">
          <div className="columns-panel">
            <strong>Columns</strong>
            <div className="columns-panel__grid">
              {[
                { key: 'name', label: 'Name' },
                { key: 'group', label: 'Group' },
                { key: 'status', label: 'Status' },
                { key: 'ip', label: 'IP' },
                { key: 'subnet', label: 'Subnet' },
                { key: 'gateway', label: 'Gateway' },
                ...extraColumns.map((c) => ({ key: c, label: c })),
                { key: 'type', label: 'Type' },
                { key: 'mac', label: 'MAC' },
                { key: 'vendor', label: 'Vendor' },
                { key: 'lastChecked', label: 'Last checked' },
                { key: 'actions', label: 'Actions' }
              ].map((c) => {
                const checked = hiddenColumns[c.key] !== true
                return (
                  <label key={c.key} className="columns-panel__item">
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={(e) => {
                        const nextVisible = e.target.checked
                        setHiddenColumns((prev) => {
                          if (nextVisible) {
                            const { [c.key]: _x, ...rest } = prev
                            return rest
                          }
                          return { ...prev, [c.key]: true }
                        })
                      }}
                    />{' '}
                    {c.label}
                  </label>
                )
              })}
            </div>
          </div>
        </div>
      ) : null}

      {mainView === 'list' && addMultipleOpen ? (
        <div className="banner banner-muted">
          <form
            onSubmit={(e) => {
              e.preventDefault()
              void (async () => {
                const n = Number.parseInt(addMultipleCount, 10)
                if (!Number.isFinite(n) || n <= 0) {
                  alert('Enter a positive whole number.')
                  return
                }
                try {
                  let lastCreatedId: string | null = null
                  for (let i = 0; i < n; i++) {
                    for (let attempt = 0; attempt < 16; attempt++) {
                      const b = new Uint8Array(1)
                      crypto.getRandomValues(b)
                      const ip = `203.0.113.${2 + (b[0] % 253)}`
                      try {
                        const created = await api.saveDevice({
                          name: 'New device',
                          ip,
                          subnet: '',
                          gateway: ''
                        })
                        lastCreatedId = created.id
                        break
                      } catch (err) {
                        const msg = err instanceof Error ? err.message : String(err)
                        if (msg.includes('already')) continue
                        throw err
                      }
                    }
                    if (!lastCreatedId) throw new Error('Could not add devices')
                  }
                  if (lastCreatedId) setFocusNameEditDeviceId(lastCreatedId)
                  setAddMultipleOpen(false)
                } catch (err) {
                  alert(err instanceof Error ? err.message : 'Could not add devices')
                }
              })()
            }}
          >
            <strong>Add Multiple…</strong>{' '}
            <label>
              Count{' '}
              <input
                className="table-input"
                type="number"
                min={1}
                step={1}
                value={addMultipleCount}
                onChange={(e) => setAddMultipleCount(e.target.value)}
              />
            </label>{' '}
            <button type="submit">Add</button>{' '}
            <button
              type="button"
              onClick={() => {
                setAddMultipleOpen(false)
              }}
            >
              Cancel
            </button>
          </form>
        </div>
      ) : null}

      {settings.listenAdapterNames.length === 0 ? (
        <div className="banner banner-warn">
          Monitoring is paused because no network adapters are selected. Devices are shown as offline and
          ARP discovery is disabled. Open `Settings` → `Open Settings…` to select adapters.
        </div>
      ) : null}

      <NetworkProfilePanel
        networkInfo={networkInfo}
        profiles={profiles}
        onProfilesUpdated={onProfilesUpdated}
        onViewingProfileChange={setViewingProfile}
      />

      {mainView === 'list' ? (
        <div className="list-page">
          <div className="list-page__top">
            <div className="list-page__top-bar">
              <input
                type="search"
                className="list-page__search"
                placeholder="Search"
                aria-label="Search"
              />
              <label className="list-page__top-bar-label">
                Filter
                <select value={filter} onChange={(e) => setFilter(e.target.value as FilterMode)}>
                  <option value="all">All</option>
                  <option value="online">Online only</option>
                  <option value="offline">Offline only</option>
                </select>
              </label>
              <label className="list-page__top-bar-label">
                Group by
                <select value={groupBy} onChange={(e) => setGroupBy(e.target.value as GroupByMode)}>
                  <option value="none">None</option>
                  <option value="subnet">Subnet</option>
                  <option value="vendor">Vendor</option>
                  <option value="deviceType">Device type</option>
                </select>
              </label>
              <button
                type="button"
                className="secondary list-page__top-sort"
                title="Sort the device list"
              >
                Sort
              </button>
              <button
                type="button"
                className="secondary list-page__top-columns"
                title="Show or hide table columns"
                onClick={() => {
                  setColumnsPanelOpen((v) => !v)
                }}
              >
                Columns…
              </button>
            </div>
          </div>
          <div className="list-page__content">
            <div className="list-page__zones">
              <div className="list-page__left">
                <button
                  type="button"
                  onClick={() => {
                    void (async () => {
                      try {
                        for (let attempt = 0; attempt < 16; attempt++) {
                          const b = new Uint8Array(1)
                          crypto.getRandomValues(b)
                          const ip = `203.0.113.${2 + (b[0] % 253)}`
                          try {
                            const created = await api.saveDevice({
                              name: 'New device',
                              ip,
                              subnet: '',
                              gateway: ''
                            })
                            setFocusNameEditDeviceId(created.id)
                            return
                          } catch (e) {
                            const msg = e instanceof Error ? e.message : String(e)
                            if (msg.includes('already')) continue
                            throw e
                          }
                        }
                        throw new Error('Could not add device')
                      } catch (e) {
                        alert(e instanceof Error ? e.message : 'Could not add device')
                      }
                    })()
                  }}
                >
                  Add device
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setAddMultipleOpen(true)
                  }}
                >
                  Add Multiple…
                </button>
              </div>
              <div className="list-page__center">
                <div className="toolbar list-page__work-actions">
                  <button
                    type="button"
                    onClick={() => {
                      setExtraColumns((cols) => cols.concat(`Column ${cols.length + 1}`))
                    }}
                  >
                    Add Column
                  </button>
                  <button type="button" onClick={() => void api.openMapViewWindow()}>
                    Open Map View Window
                  </button>
                </div>
                <div className="list-view-split">
                  <div className="list-view-split__table">
                    <DeviceTable
                      devices={filtered}
                      groups={groups}
                      groupBy={groupBy}
                      sortKey={sortKey}
                      sortDir={sortDir}
                      onSort={toggleSort}
                      onDelete={(id) => void handleDelete(id)}
                      onSetDeviceGroup={async (deviceId, groupId) => {
                        try {
                          await api.setDeviceGroup(deviceId, groupId)
                        } catch (e) {
                          alert(e instanceof Error ? e.message : 'Could not update group')
                        }
                      }}
                      onSaveDevice={async (payload) => {
                        await api.saveDevice(payload)
                      }}
                      extraColumns={extraColumns}
                      hiddenColumns={hiddenColumns}
                      getExtraColumnValue={(deviceId, col) => extraColumnValues[deviceId]?.[col] ?? ''}
                      onSetExtraColumnValue={(deviceId, col, value) => {
                        setExtraColumnValues((prev) => ({
                          ...prev,
                          [deviceId]: { ...(prev[deviceId] ?? {}), [col]: value }
                        }))
                      }}
                      onRenameExtraColumn={(oldName, newName) => {
                        if (extraColumns.includes(newName)) {
                          alert('A column with that name already exists.')
                          return
                        }
                        setExtraColumns((cols) => cols.map((c) => (c === oldName ? newName : c)))
                        setExtraColumnValues((prev) => {
                          const out: typeof prev = {}
                          for (const deviceId of Object.keys(prev)) {
                            const row = prev[deviceId] ?? {}
                            if (!(oldName in row)) {
                              out[deviceId] = row
                              continue
                            }
                            const { [oldName]: v, ...rest } = row
                            out[deviceId] = { ...rest, [newName]: v }
                          }
                          return out
                        })
                        setColumnWidthsPx((prev) => {
                          if (!(oldName in prev)) return prev
                          const { [oldName]: w, ...rest } = prev
                          return { ...rest, [newName]: w }
                        })
                        setHiddenColumns((prev) => {
                          if (!(oldName in prev)) return prev
                          const { [oldName]: h, ...rest } = prev
                          return { ...rest, [newName]: h }
                        })
                      }}
                      onDeleteExtraColumn={(name) => {
                        setExtraColumns((cols) => cols.filter((c) => c !== name))
                        setExtraColumnValues((prev) => {
                          const out: typeof prev = {}
                          for (const deviceId of Object.keys(prev)) {
                            const row = prev[deviceId] ?? {}
                            if (!(name in row)) {
                              out[deviceId] = row
                              continue
                            }
                            const { [name]: _v, ...rest } = row
                            out[deviceId] = rest
                          }
                          return out
                        })
                        setColumnWidthsPx((prev) => {
                          const { [name]: _w, ...rest } = prev
                          return rest
                        })
                        setHiddenColumns((prev) => {
                          const { [name]: _h, ...rest } = prev
                          return rest
                        })
                      }}
                      getColumnWidthPx={(key) => columnWidthsPx[key]}
                      onSetColumnWidthPx={(key, w) => {
                        setColumnWidthsPx((prev) => ({ ...prev, [key]: w }))
                      }}
                      focusNameEditDeviceId={focusNameEditDeviceId}
                      onFocusNameEditHandled={onFocusNameEditHandled}
                      selectedDeviceId={selectedDeviceId}
                      onSelectDevice={(id) => setSelectedDeviceId(id)}
                    />
                  </div>
                </div>
              </div>
              <div className="list-page__right">
                <aside className="list-inspector" aria-label="Device details">
                  {selectedDevice ? (
                    <>
                      <div className="list-inspector__header">
                        <strong>Device</strong>
                        <button type="button" onClick={() => setSelectedDeviceId(null)}>
                          Close
                        </button>
                      </div>
                      <div className="list-inspector__body">
                        <div className="list-inspector__row">
                          <span className="muted">Name</span>
                          <input
                            className="table-input"
                            type="text"
                            value={inspectorDraft.name}
                            disabled={inspectorSaving}
                            onChange={(e) => setInspectorDraft((d) => ({ ...d, name: e.target.value }))}
                          />
                        </div>
                        <div className="list-inspector__row">
                          <span className="muted">IP</span>
                          <input
                            className="table-input"
                            type="text"
                            value={inspectorDraft.ip}
                            disabled={inspectorSaving}
                            onChange={(e) => setInspectorDraft((d) => ({ ...d, ip: e.target.value }))}
                          />
                        </div>
                        <div className="list-inspector__row">
                          <span className="muted">Subnet</span>
                          <input
                            className="table-input"
                            type="text"
                            value={inspectorDraft.subnet}
                            disabled={inspectorSaving}
                            onChange={(e) => setInspectorDraft((d) => ({ ...d, subnet: e.target.value }))}
                          />
                        </div>
                        <div className="list-inspector__row">
                          <span className="muted">Gateway</span>
                          <input
                            className="table-input"
                            type="text"
                            value={inspectorDraft.gateway}
                            disabled={inspectorSaving}
                            onChange={(e) => setInspectorDraft((d) => ({ ...d, gateway: e.target.value }))}
                          />
                        </div>
                        <div className="list-inspector__row">
                          <span className="muted">Save</span>
                          <button
                            type="button"
                            disabled={inspectorSaving}
                            onClick={() => {
                              void (async () => {
                                setInspectorSaving(true)
                                try {
                                  const next = await api.saveDevice({
                                    id: selectedDevice.id,
                                    name: inspectorDraft.name,
                                    ip: inspectorDraft.ip,
                                    subnet: inspectorDraft.subnet,
                                    gateway: inspectorDraft.gateway,
                                    groupId: selectedDevice.groupId
                                  })
                                  setInspectorDraft({
                                    name: next.name,
                                    ip: next.ip,
                                    subnet: next.subnet,
                                    gateway: next.gateway
                                  })
                                } catch (e) {
                                  alert(e instanceof Error ? e.message : 'Save failed.')
                                } finally {
                                  setInspectorSaving(false)
                                }
                              })()
                            }}
                          >
                            Save
                          </button>
                        </div>
                        <div className="list-inspector__row">
                          <span className="muted">Status</span>
                          <span>{selectedDevice.lastStatus}</span>
                        </div>
                        <div className="list-inspector__row">
                          <span className="muted">Last checked</span>
                          <span>
                            {selectedDevice.lastChecked ? new Date(selectedDevice.lastChecked).toLocaleString() : '—'}
                          </span>
                        </div>
                      </div>
                    </>
                  ) : (
                    <p className="muted">Select a device to view details.</p>
                  )}
                </aside>
              </div>
            </div>
          </div>
        </div>
      ) : (
        <Suspense fallback={<p className="muted">Loading map…</p>}>
          <MapView
            devices={filtered}
            networkInfo={networkInfo}
            deviceGroups={groups}
            onSaveDevice={async (payload) => {
              await api.saveDevice(payload)
            }}
          />
        </Suspense>
      )}

      <DiscoveredPanel
        entries={discovered}
        savedIps={savedIps}
        onRefresh={async () => {
          setDiscovered([])
          try {
            const p = await api.refreshArp()
            setDiscovered(p.discovered)
          } catch {
            const arp = await api.getArp()
            setDiscovered(arp.discovered)
          }
        }}
        onAddToList={(e) => {
          const name = e.vendor?.trim()
            ? `${e.vendor.trim()} (${e.ip})`
            : `Device ${e.ip}`
          setFormPrefill({ name, ip: e.ip, subnet: '', gateway: '' })
          setFormModalKey((k) => k + 1)
          setFormDevice('new')
        }}
        onDismiss={async (e) => {
          await api.dismissDiscoveredIp(e.ip)
        }}
        onClearDismissed={async () => {
          await api.clearDismissedDiscovered()
        }}
      />

      <EventLogPanel activeNetworkId={networkInfo?.networkId ?? null} profiles={profiles} />

      {formDevice !== null ? (
        <DeviceForm
          key={formModalKey}
          device={formDevice === 'new' ? null : formDevice}
          groups={groups}
          prefill={formDevice === 'new' ? formPrefill : null}
          onClose={() => {
            setFormDevice(null)
            setFormPrefill(null)
          }}
          onSave={async (payload) => {
            await api.saveDevice(payload)
          }}
        />
      ) : null}

      {settingsOpen ? (
        <SettingsModal settings={settings} groups={groups} onClose={() => setSettingsOpen(false)} />
      ) : null}

      {newNetwork ? (
        <NewNetworkDetectedModal
          payload={newNetwork}
          onClose={() => setNewNetwork(null)}
          onIgnore={async () => {
            await api.ignoreNewNetwork(newNetwork.networkId)
          }}
          onSave={async (name) => {
            await api.createNetworkProfile({
              networkId: newNetwork.networkId,
              name,
              ssid: newNetwork.ssid,
              gateway: newNetwork.gateway,
              subnet: newNetwork.subnet
            })
            const [n, prof] = await Promise.all([api.getNetworkInfo(), api.getNetworkProfiles()])
            setNetworkInfo(n)
            setProfiles(prof)
          }}
        />
      ) : null}
    </div>
  )
}
