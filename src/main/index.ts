import { app, BrowserWindow, dialog, ipcMain, Menu, type MenuItemConstructorOptions } from 'electron'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import { writeFile } from 'fs/promises'
import { getDatabase, closeDatabase } from './db/database'
import {
  debugResolveEquipmentRuntimeProjectionWithJsonHydration,
  listDevices,
  verifyAllEquipmentValuesMirrorRows,
  verifyEquipmentValuesMirrorRow
} from './db/deviceRepository'
import {
  applyUserSaveDevicePayload,
  applyUserSetDeviceGroup,
  deleteAllDevices,
  deleteDevice,
  deleteDevicesForNetwork
} from './services/equipmentMutationService'
import {
  deleteDeviceGroup,
  listDeviceGroups,
  saveDeviceGroup
} from './db/groupRepository'
import {
  clearDismissedDiscovered,
  deleteAllArpEntries,
  deleteArpEntriesForNetwork,
  dismissDiscoveredIp,
  listArpEntries,
  listDiscoveredDevices
} from './db/arpRepository'
import { scanArpCache } from './services/arpService'
import { notifyNewUnknownDevices } from './services/notificationService'
import { getSettings, saveSettings } from './db/settingsRepository'
import { startScheduler, type SchedulerHandles } from './services/scheduler'
import { createTray, updateTrayTooltip } from './tray'
import { listNetworkAdapters } from './services/networkAdapterService'
import {
  ensureInitialNetworkContext,
  getLastNetworkContext,
  getStableNetworkId,
  normalizeNetworkId,
  startNetworkWatch
} from './services/networkDetection'
import { clearVendorLookupCache } from './services/vendorLookup'
import { IPC } from '@shared/ipc'
import type {
  AppSettings,
  CreateMapManualGroupPayload,
  CreateNetworkProfilePayload,
  EventType,
  GetEventLogsQuery,
  MapLayoutSavePayload,
  MapManualTrace,
  NewNetworkDetectedPayload,
  NetworkInfo,
  PurgeDeviceCachePayload,
  SaveMapManualTracePayload,
  SetMapManualGroupLockPayload,
  ShowMapNodeContextMenuPayload,
  RenameMapManualGroupPayload,
  RenameNetworkProfilePayload,
  SaveAlertRulePayload,
  SaveDeviceGroupPayload,
  SaveDevicePayload
} from '@shared/types'
import { deleteAlertRule, listAlertRules, saveAlertRule } from './db/alertRuleRepository'
import {
  createManualGroup,
  deleteManualGroup,
  deleteMapLayoutForNetwork,
  getManualGroup,
  getMapLayoutBundle,
  renameManualGroup,
  setManualGroupContentsLocked,
  upsertManualGroupLayouts,
  upsertMapLayoutPositions
} from './db/mapLayoutRepository'
import { listManualTracesForNetwork, upsertManualTrace } from './db/mapManualTraceRepository'
import {
  onDiscoveryScanComplete,
  resetAlertDiscoveryBaseline
} from './services/alertRulesEngine'
import { EventLogService } from './services/eventLogService'
import { deleteEventLogs, listEventLogs } from './db/eventLogRepository'
import { EVENT_LOG_NETWORK_UNKNOWN } from '@shared/eventLog'
import {
  createNetworkProfile,
  getNetworkProfileByNetworkId,
  deleteNetworkProfileById,
  listNetworkProfiles,
  renameNetworkProfile,
  syncNetworkProfileFromContext
} from './db/networkProfileRepository'

const __dirname = dirname(fileURLToPath(import.meta.url))

// Fail fast with clear logging when a startup-time async error occurs (e.g. migration failure).
process.on('unhandledRejection', (reason) => {
  console.error('[main] Unhandled promise rejection', reason)
  try {
    dialog.showErrorBox('System Status startup error', String(reason instanceof Error ? reason.message : reason))
  } catch {
    /* ignore */
  }
  app.exit(1)
})

let mainWindow: BrowserWindow | null = null
let tray: ReturnType<typeof createTray> | null = null
let scheduler: SchedulerHandles | null = null
let networkWatch: ReturnType<typeof startNetworkWatch> | null = null
let isQuitting = false
let schedulerRestartTimer: NodeJS.Timeout | null = null
const ignoredNewNetworkIds = new Set<string>()
let eventLogs: EventLogService | null = null

// Secondary window (hardcoded single-instance placeholder).
let isMapWindowOpen = false
let mapWindow: BrowserWindow | null = null

// Cross-window selection authority (in-memory; v1 equipment ids only).
let selectedEquipmentIds: string[] = []

/**
 * Use the latest sampled context for UI filtering (fast), falling back to debounced stable id.
 * This prevents lists from getting "stuck" on the previous LAN during Wi‑Fi switches.
 */
function uiNetworkId(): string | null {
  return getLastNetworkContext()?.networkId ?? getStableNetworkId()
}

/** Live fingerprint + joined profile (friendly name, last time this LAN was seen in-app). */
function networkInfoPayload(): NetworkInfo | null {
  const ctx = getLastNetworkContext()
  if (!ctx) return null
  const p = getNetworkProfileByNetworkId(getDatabase(), ctx.networkId)
  return {
    networkId: ctx.networkId,
    cidr: ctx.cidr,
    gateway: ctx.gateway,
    localIpv4: ctx.localIpv4,
    netmask: ctx.netmask,
    wifiSsid: ctx.wifiSsid ?? null,
    profileId: p?.id,
    profileName: p?.name,
    profileLastSeen: p?.lastSeen
  }
}

function pushNetworkProfilesToRenderer(): void {
  const payload = listNetworkProfiles(getDatabase(), uiNetworkId())
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(IPC.ON_NETWORK_PROFILES_CHANGED, payload)
  }
  if (mapWindow && !mapWindow.isDestroyed()) {
    mapWindow.webContents.send(IPC.ON_NETWORK_PROFILES_CHANGED, payload)
  }
}

function pushNetworkInfoUpdated(): void {
  const payload = networkInfoPayload()
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(IPC.ON_NETWORK_INFO_UPDATED, payload)
  }
  if (mapWindow && !mapWindow.isDestroyed()) {
    mapWindow.webContents.send(IPC.ON_NETWORK_INFO_UPDATED, payload)
  }
}

/** After any persisted map layout mutation; map surfaces re-fetch from SQLite (no cross-renderer state mirroring). */
function pushMapLayoutInvalidated(rawNetworkId: string): void {
  const nid = normalizeNetworkId(rawNetworkId)
  if (!nid) return
  const payload = { networkId: nid }
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(IPC.ON_MAP_LAYOUT_INVALIDATED, payload)
  }
  if (mapWindow && !mapWindow.isDestroyed()) {
    mapWindow.webContents.send(IPC.ON_MAP_LAYOUT_INVALIDATED, payload)
  }
}

function pushSelectedEquipmentIdsChanged(): void {
  const payload = { selectedEquipmentIds }
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(IPC.ON_SELECTED_EQUIPMENT_IDS_CHANGED, payload)
  }
  if (mapWindow && !mapWindow.isDestroyed()) {
    mapWindow.webContents.send(IPC.ON_SELECTED_EQUIPMENT_IDS_CHANGED, payload)
  }
}

function pushAlertRulesToRenderer(): void {
  if (!mainWindow || mainWindow.isDestroyed()) return
  mainWindow.webContents.send(IPC.ON_ALERT_RULES_CHANGED, listAlertRules(getDatabase()))
}

function pushEventToRenderer(ev: import('@shared/types').EventLog): void {
  if (!mainWindow || mainWindow.isDestroyed()) return
  mainWindow.webContents.send(IPC.ON_EVENT_LOG_ADDED, ev)
}

function openSettings(): void {
  if (!mainWindow || mainWindow.isDestroyed()) return
  mainWindow.show()
  mainWindow.focus()
  mainWindow.webContents.send(IPC.SHOW_SETTINGS)
}

/** Shared fix for post-delete caret-without-typing: OS must target webContents, not only renderer focus. */
function focusBrowserWindowForKeyboardFromMain(context: string): void {
  if (process.env['SS_NATIVE_FOCUS_DEBUG'] === '1') {
    console.info('[SS-NATIVE-FOCUS][main]', context)
  }
  const w = mainWindow
  if (!w || w.isDestroyed()) return
  if (!w.isVisible()) w.show()
  w.focus()
  w.webContents.focus()
}

function buildMenu(): void {
  const template: MenuItemConstructorOptions[] = [
    {
      label: 'File',
      submenu: [{ role: 'quit' }]
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' }
      ]
    },
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { role: 'forceReload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' }
      ]
    },
    {
      label: 'Settings',
      submenu: [
        {
          label: 'Open Settings…',
          accelerator: 'Ctrl+,',
          click: () => openSettings()
        }
      ]
    },
    {
      label: 'Window',
      submenu: [{ role: 'minimize' }, { role: 'close' }]
    },
    {
      label: 'Help',
      submenu: [
        {
          label: 'About',
          click: () => openSettings()
        }
      ]
    }
  ]

  const menu = Menu.buildFromTemplate(template)
  Menu.setApplicationMenu(menu)
}

function devRendererUrl(): string | undefined {
  return (
    process.env['ELECTRON_RENDERER_URL'] ||
    process.env['VITE_DEV_SERVER_URL'] ||
    undefined
  )
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1000,
    height: 680,
    show: false,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  const url = devRendererUrl()
  if (url) void mainWindow.loadURL(url)
  else mainWindow.loadFile(join(__dirname, '../renderer/index.html'))

  mainWindow.once('ready-to-show', () => mainWindow?.show())

  mainWindow.on('close', (e) => {
    if (isQuitting) return
    e.preventDefault()
    mainWindow?.hide()
  })
}

function traySummary(): string {
  const db = getDatabase()
  const devices = listDevices(db, uiNetworkId())
  const offline = devices.filter((d) => d.lastStatus === 'offline').length
  if (offline === 0) return 'System Status — all online'
  return `System Status — ${offline} offline`
}

function refreshTray(): void {
  updateTrayTooltip(tray, traySummary)
}

function pushArpToRenderer(): void {
  const db = getDatabase()
  const nid = uiNetworkId()
  const payload = {
    entries: listArpEntries(db, nid),
    discovered: listDiscoveredDevices(db, nid)
  }
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(IPC.ON_ARP_CHANGED, payload)
  }
  if (mapWindow && !mapWindow.isDestroyed()) {
    mapWindow.webContents.send(IPC.ON_ARP_CHANGED, payload)
  }
}

function pushDeviceGroupsToRenderer(): void {
  const payload = listDeviceGroups(getDatabase())
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(IPC.ON_DEVICE_GROUPS_CHANGED, payload)
  }
  if (mapWindow && !mapWindow.isDestroyed()) {
    mapWindow.webContents.send(IPC.ON_DEVICE_GROUPS_CHANGED, payload)
  }
}

function registerIpc(): void {
  ipcMain.handle(IPC.GET_SELECTED_EQUIPMENT_IDS, () => selectedEquipmentIds)

  ipcMain.handle(IPC.SET_SELECTED_EQUIPMENT_IDS, (_e, ids: unknown) => {
    const next = Array.isArray(ids) ? ids.map((x) => String(x)) : []
    // Keep stable ordering for simple equality checks in renderers.
    next.sort()
    const prev = selectedEquipmentIds
    if (prev.length === next.length && prev.every((v, i) => v === next[i])) return
    selectedEquipmentIds = next
    pushSelectedEquipmentIdsChanged()
  })

  ipcMain.handle(IPC.OPEN_MAP_VIEW_WINDOW, async () => {
    if (mapWindow && mapWindow.isDestroyed()) {
      mapWindow = null
      isMapWindowOpen = false
    }
    if (isMapWindowOpen) return
    try {
      const bounds = mainWindow?.getBounds()
      const w = new BrowserWindow({
        width: 720,
        height: 480,
        title: 'Map View',
        ...(bounds
          ? {
              x: bounds.x + 40,
              y: bounds.y + 40
            }
          : {}),
        webPreferences: {
          preload: join(__dirname, '../preload/index.js'),
          contextIsolation: true
        }
      })
      mapWindow = w
      isMapWindowOpen = true
      w.on('closed', () => {
        mapWindow = null
        isMapWindowOpen = false
      })
      // Ensure new surface starts with current shared selection.
      w.webContents.once('did-finish-load', () => {
        pushSelectedEquipmentIdsChanged()
      })

      const url = devRendererUrl()
      if (url) await w.loadURL(`${url}#map-window`)
      else await w.loadFile(join(__dirname, '../renderer/index.html'), { hash: 'map-window' })
    } catch {
      mapWindow = null
      isMapWindowOpen = false
    }
  })

  ipcMain.handle(IPC.FOCUS_MAP_VIEW_WINDOW_IF_OPEN, () => {
    if (mapWindow && mapWindow.isDestroyed()) {
      mapWindow = null
      isMapWindowOpen = false
    }
    if (mapWindow && !mapWindow.isDestroyed()) {
      if (mapWindow.isMinimized()) {
        mapWindow.restore()
      }
      mapWindow.focus()
      return true
    }
    return false
  })

  ipcMain.handle(IPC.FOCUS_BROWSER_WINDOW_FOR_KEYBOARD, (event, context?: string) => {
    const senderWin = BrowserWindow.fromWebContents(event.sender)
    if (senderWin && !senderWin.isDestroyed()) {
      if (!senderWin.isVisible()) senderWin.show()
      senderWin.focus()
      senderWin.webContents.focus()
      return
    }
    focusBrowserWindowForKeyboardFromMain(typeof context === 'string' ? context : 'unknown')
  })

  ipcMain.handle(IPC.GET_NETWORK_INFO, () => networkInfoPayload())

  ipcMain.handle(IPC.GET_NETWORK_PROFILES, () =>
    listNetworkProfiles(getDatabase(), uiNetworkId())
  )

  ipcMain.handle(IPC.CREATE_NETWORK_PROFILE, (_e, payload: CreateNetworkProfilePayload) => {
    const db = getDatabase()
    const nid = normalizeNetworkId(payload.networkId)
    if (nid === EVENT_LOG_NETWORK_UNKNOWN) {
      throw new Error('Cannot save an unknown-network event scope as a real network profile.')
    }
    const p = createNetworkProfile(db, payload)
    ignoredNewNetworkIds.delete(p.networkId)
    pushNetworkProfilesToRenderer()
    pushNetworkInfoUpdated()
    return p
  })

  ipcMain.handle(IPC.IGNORE_NEW_NETWORK, (_e, networkId: string) => {
    const nid = normalizeNetworkId(networkId)
    if (nid === EVENT_LOG_NETWORK_UNKNOWN) return
    if (nid) ignoredNewNetworkIds.add(nid)
  })

  ipcMain.handle(IPC.RENAME_NETWORK_PROFILE, (_e, payload: RenameNetworkProfilePayload) => {
    const p = renameNetworkProfile(getDatabase(), payload.id, payload.name)
    pushNetworkProfilesToRenderer()
    pushNetworkInfoUpdated()
    return p
  })

  ipcMain.handle(IPC.DELETE_NETWORK_PROFILE, async (_e, id: string) => {
    const db = getDatabase()
    const list = listNetworkProfiles(db, uiNetworkId())
    const target = list.find((p) => p.id === id) ?? null
    if (!target) throw new Error('Profile not found')
    if (target.isActive) {
      throw new Error('Cannot delete the active network. Connect to a different network first.')
    }
    const { networkId } = deleteNetworkProfileById(db, id)
    // Remove all scoped data for this network id to avoid cross-network leakage/orphans.
    await deleteDevicesForNetwork(db, networkId, { source: 'user' })
    deleteArpEntriesForNetwork(db, networkId)
    deleteMapLayoutForNetwork(db, networkId)
    pushMapLayoutInvalidated(networkId)
    db.prepare(`DELETE FROM alert_rules WHERE network_id = ?`).run(networkId)
    pushNetworkProfilesToRenderer()
    pushNetworkInfoUpdated()
    mainWindow?.webContents.send(IPC.ON_DEVICES_CHANGED, listDevices(db, uiNetworkId()))
    pushArpToRenderer()
    refreshTray()
  })

  ipcMain.handle(IPC.GET_EVENT_LOGS, (_e, query?: GetEventLogsQuery) => {
    try {
      return listEventLogs(getDatabase(), query ?? {})
    } catch (e) {
      eventLogs?.logSystemErrorThrottled({
        key: 'ipc.getEventLogs',
        module: 'ipc',
        operation: 'GET_EVENT_LOGS',
        error: e,
        networkId: uiNetworkId()
      })
      throw e
    }
  })

  ipcMain.handle(IPC.CLEAR_EVENT_LOGS, (_e, payload: import('@shared/types').ClearEventLogsPayload) => {
    try {
      const rowsDeleted = deleteEventLogs(getDatabase(), payload?.query ?? {})
      return { rowsDeleted }
    } catch (e) {
      eventLogs?.logSystemErrorThrottled({
        key: 'ipc.clearEventLogs',
        module: 'ipc',
        operation: 'CLEAR_EVENT_LOGS',
        error: e,
        networkId: uiNetworkId()
      })
      throw e
    }
  })

  ipcMain.handle(IPC.EXPORT_EVENT_LOGS, async (_e, payload: import('@shared/types').ExportEventLogsPayload) => {
    const db = getDatabase()
    try {
      const query = payload?.query ?? {}
      const rows = listEventLogs(db, { ...query, limit: 5000 })

      // Build network label map for export context (never treat `network_unknown` as a real profile).
      const profs = listNetworkProfiles(db, uiNetworkId())
      const labelByNetworkId = new Map<string, string>()
      for (const p of profs) labelByNetworkId.set(p.networkId, p.name)
      labelByNetworkId.set(EVENT_LOG_NETWORK_UNKNOWN, 'Unknown Network')

      const now = new Date()
      const isoDate = now.toISOString().slice(0, 10)
      const scopeLabel =
        query.networkId && String(query.networkId).trim() !== ''
          ? (labelByNetworkId.get(String(query.networkId).trim()) ?? 'network')
          : 'all'
      const typeLabel = query.eventType ? String(query.eventType) : 'all'
      const ext = payload.format === 'json' ? 'json' : 'csv'
      const defaultPath = `event-logs-${scopeLabel}-${typeLabel}-${isoDate}.${ext}`

      const result = await dialog.showSaveDialog({
        title: 'Export event logs',
        defaultPath,
        filters:
          payload.format === 'json'
            ? [{ name: 'JSON', extensions: ['json'] }]
            : [{ name: 'CSV', extensions: ['csv'] }]
      })
      if (result.canceled || !result.filePath) {
        return { savedPath: null, rowsExported: 0 }
      }

      if (payload.format === 'json') {
        const out = rows.map((r) => ({
          ...r,
          networkLabel: labelByNetworkId.get(r.networkId) ?? null
        }))
        await writeFile(result.filePath, JSON.stringify(out, null, 2), 'utf8')
      } else {
        /**
         * CSV export is optimized for spreadsheets/humans:
         * - We do NOT dump the full metadata JSON blob into one cell.
         * - We flatten a handful of commonly useful metadata fields into columns.
         * - JSON export remains the full-fidelity format.
         */
        const esc = (v: unknown): string => {
          const s = v == null ? '' : String(v)
          const needs = /[",\r\n]/.test(s)
          const inner = s.replace(/"/g, '""')
          return needs ? `"${inner}"` : inner
        }

        const metaStr = (m: Record<string, unknown>, k: string): string =>
          m[k] == null ? '' : String(m[k])
        const metaBool = (m: Record<string, unknown>, k: string): string =>
          m[k] == null ? '' : String(Boolean(m[k]))

        const csvRow = (r: import('@shared/types').EventLog): string => {
          const m = (r.metadata ?? {}) as Record<string, unknown>
          const notification = (m['notification'] ?? {}) as Record<string, unknown>
          return [
            // core fields
            esc(r.timestamp),
            esc(r.severity),
            esc(r.eventType),
            esc(r.message),
            esc(r.networkId),
            esc(labelByNetworkId.get(r.networkId) ?? ''),
            esc(r.deviceId ?? ''),
            esc(r.ipAddress ?? ''),
            esc(r.macAddress ?? ''),
            esc(r.ssid ?? ''),
            // flattened metadata (common/debuggable)
            esc(metaStr(m, 'ruleId')),
            esc(metaStr(m, 'ruleName')),
            esc(metaStr(m, 'conditionType')),
            esc(metaStr(m, 'triggeringEventType')),
            esc(metaStr(m, 'cooldownSeconds')),
            esc(metaBool(m, 'networkContextUnavailable')),
            esc(metaStr(m, 'scope')),
            esc(metaStr(notification, 'title')),
            esc(metaStr(notification, 'body')),
            esc(metaStr(m, 'vendor')),
            esc(metaStr(m, 'deviceType')),
            esc(metaStr(m, 'matchedSavedDevice')),
            esc(metaStr(m, 'savedDeviceId')),
            esc(metaStr(m, 'savedDeviceName'))
          ].join(',')
        }

        const header = [
          'timestamp',
          'severity',
          'eventType',
          'message',
          'networkId',
          'networkLabel',
          'deviceId',
          'ipAddress',
          'macAddress',
          'ssid',
          // flattened metadata columns
          'ruleId',
          'ruleName',
          'conditionType',
          'triggeringEventType',
          'cooldownSeconds',
          'networkContextUnavailable',
          'scope',
          'notificationTitle',
          'notificationBody',
          'vendor',
          'deviceType',
          'matchedSavedDevice',
          'savedDeviceId',
          'savedDeviceName'
        ].join(',')
        const lines = rows.map(csvRow)
        await writeFile(result.filePath, [header, ...lines].join('\r\n'), 'utf8')
      }

      return { savedPath: result.filePath, rowsExported: rows.length }
    } catch (e) {
      eventLogs?.logSystemErrorThrottled({
        key: 'ipc.exportEventLogs',
        module: 'ipc',
        operation: 'EXPORT_EVENT_LOGS',
        error: e,
        networkId: uiNetworkId()
      })
      throw e
    }
  })

  ipcMain.handle(IPC.GET_ALERT_RULES, () => listAlertRules(getDatabase()))

  ipcMain.handle(IPC.SAVE_ALERT_RULE, (_e, payload: SaveAlertRulePayload) => {
    const r = saveAlertRule(getDatabase(), payload)
    pushAlertRulesToRenderer()
    return r
  })

  ipcMain.handle(IPC.DELETE_ALERT_RULE, (_e, id: string) => {
    const ok = deleteAlertRule(getDatabase(), id)
    if (ok) pushAlertRulesToRenderer()
    return ok
  })

  ipcMain.handle(IPC.PURGE_DEVICE_CACHE, async (_e, payload: PurgeDeviceCachePayload) => {
    const db = getDatabase()
    let devicesRemoved = 0
    let arpRemoved = 0
    if (payload.scope === 'all') {
      devicesRemoved = (await deleteAllDevices(db, { source: 'user' })).deletedCount
      if (payload.includeArp) {
        arpRemoved = deleteAllArpEntries(db)
        clearDismissedDiscovered(db)
      }
    } else {
      const nid = uiNetworkId()
      if (!nid) {
        throw new Error(
          'Not connected to a recognized network — connect first, or use “all networks” purge.'
        )
      }
      devicesRemoved = (await deleteDevicesForNetwork(db, nid, { source: 'user' })).deletedCount
      if (payload.includeArp) {
        arpRemoved = deleteArpEntriesForNetwork(db, nid)
      }
    }
    clearVendorLookupCache()
    mainWindow?.webContents.send(IPC.ON_DEVICES_CHANGED, listDevices(db, uiNetworkId()))
    pushArpToRenderer()
    pushNetworkProfilesToRenderer()
    refreshTray()
    return { devicesRemoved, arpRemoved }
  })

  ipcMain.handle(IPC.GET_MAP_LAYOUT, (_e, networkId: string) => {
    const nid = normalizeNetworkId(networkId)
    if (!nid) return { manualGroups: [], positions: {} }
    return getMapLayoutBundle(getDatabase(), nid)
  })

  ipcMain.handle(IPC.SAVE_MAP_LAYOUT, (_e, payload: MapLayoutSavePayload) => {
    const nid = normalizeNetworkId(payload.networkId)
    if (!nid) return
    const db = getDatabase()
    upsertMapLayoutPositions(db, nid, payload.positions)
    if (payload.manualGroupLayouts?.length) {
      upsertManualGroupLayouts(db, nid, payload.manualGroupLayouts)
    }
    pushMapLayoutInvalidated(nid)
  })

  ipcMain.handle(IPC.UPSERT_MAP_MANUAL_TRACE, (_e, payload: SaveMapManualTracePayload) => {
    const nid = normalizeNetworkId(payload.networkId)
    if (!nid) throw new Error('Invalid network')
    const src = String(payload.sourceDeviceId ?? '').trim()
    const dst = String(payload.destinationDeviceId ?? '').trim()
    if (!src || !dst) throw new Error('Source and destination devices are required')
    if (src === dst) throw new Error('Source and destination must be different devices')
    if (!Array.isArray(payload.path) || payload.path.length === 0) throw new Error('Path must have at least one point')
    const db = getDatabase()
    const row = upsertManualTrace(db, {
      networkId: nid,
      sourceDeviceId: src,
      destinationDeviceId: dst,
      connectionType: payload.connectionType,
      sourceSnapPointId: String(payload.sourceSnapPointId ?? '').trim(),
      destinationSnapPointId: String(payload.destinationSnapPointId ?? '').trim(),
      path: payload.path
    })
    pushMapLayoutInvalidated(nid)
    return row
  })

  ipcMain.handle(IPC.GET_MAP_MANUAL_TRACES, (_e, networkId: string) => {
    const nid = normalizeNetworkId(networkId)
    if (!nid) return [] as MapManualTrace[]
    return listManualTracesForNetwork(getDatabase(), nid)
  })

  ipcMain.handle(IPC.CREATE_MAP_MANUAL_GROUP, (_e, payload: CreateMapManualGroupPayload) => {
    const nid = normalizeNetworkId(payload.networkId)
    if (!nid) throw new Error('Invalid network')
    const row = createManualGroup(getDatabase(), { ...payload, networkId: nid })
    pushMapLayoutInvalidated(nid)
    return row
  })

  ipcMain.handle(IPC.RENAME_MAP_MANUAL_GROUP, (_e, payload: RenameMapManualGroupPayload) => {
    const db = getDatabase()
    const g = getManualGroup(db, payload.id)
    renameManualGroup(db, payload)
    if (g?.networkId) pushMapLayoutInvalidated(g.networkId)
  })

  ipcMain.handle(IPC.DELETE_MAP_MANUAL_GROUP, (_e, id: string) => {
    const db = getDatabase()
    const g = getManualGroup(db, String(id))
    deleteManualGroup(db, String(id))
    if (g?.networkId) pushMapLayoutInvalidated(g.networkId)
  })

  ipcMain.handle(IPC.SET_MAP_MANUAL_GROUP_LOCK, (_e, payload: SetMapManualGroupLockPayload) => {
    setManualGroupContentsLocked(getDatabase(), { id: String(payload.id), locked: Boolean(payload.locked) })
    mainWindow?.webContents.send(IPC.ON_MAP_MANUAL_GROUP_LOCK_CHANGED, {
      id: String(payload.id),
      locked: Boolean(payload.locked)
    })
  })

  ipcMain.handle(IPC.SHOW_MAP_NODE_CONTEXT_MENU, (e, payload: ShowMapNodeContextMenuPayload) => {
    const win = BrowserWindow.fromWebContents(e.sender)
    if (!win || win.isDestroyed()) return
    const x = Math.round(payload.x)
    const y = Math.round(payload.y)
    if (payload.target.kind === 'manualGroup') {
      const locked = Boolean(payload.target.contentsLocked)
      // Build menu with explicit click handlers (no IPC recursion).
      const gid = payload.target.id
      const menu = Menu.buildFromTemplate([
        {
          label: locked ? 'Unlock group' : 'Lock group',
          click: () => {
            const nextLocked = !locked
            setManualGroupContentsLocked(getDatabase(), { id: gid, locked: nextLocked })
            const payload = {
              id: gid,
              locked: nextLocked
            }
            if (mainWindow && !mainWindow.isDestroyed()) {
              mainWindow.webContents.send(IPC.ON_MAP_MANUAL_GROUP_LOCK_CHANGED, payload)
            }
            if (mapWindow && !mapWindow.isDestroyed()) {
              mapWindow.webContents.send(IPC.ON_MAP_MANUAL_GROUP_LOCK_CHANGED, payload)
            }
          }
        },
        { type: 'separator' },
        {
          label: 'Auto size',
          click: () => {
            const payload = {
              action: 'autoSize',
              groupId: gid
            }
            if (mainWindow && !mainWindow.isDestroyed()) {
              mainWindow.webContents.send(IPC.ON_MAP_MANUAL_GROUP_LAYOUT_ACTION, payload)
            }
            if (mapWindow && !mapWindow.isDestroyed()) {
              mapWindow.webContents.send(IPC.ON_MAP_MANUAL_GROUP_LAYOUT_ACTION, payload)
            }
          }
        },
        {
          label: 'Auto align',
          click: () => {
            const payload = {
              action: 'autoAlign',
              groupId: gid
            }
            if (mainWindow && !mainWindow.isDestroyed()) {
              mainWindow.webContents.send(IPC.ON_MAP_MANUAL_GROUP_LAYOUT_ACTION, payload)
            }
            if (mapWindow && !mapWindow.isDestroyed()) {
              mapWindow.webContents.send(IPC.ON_MAP_MANUAL_GROUP_LAYOUT_ACTION, payload)
            }
          }
        }
      ])
      menu.popup({ window: win, x, y })
      return
    }
    const menu = Menu.buildFromTemplate([{ label: 'Device actions (coming soon)', enabled: false }])
    menu.popup({ window: win, x, y })
  })

  ipcMain.handle(IPC.RESET_MAP_LAYOUT, (_e, networkId: string) => {
    const nid = normalizeNetworkId(networkId)
    if (!nid) return
    deleteMapLayoutForNetwork(getDatabase(), nid)
    pushMapLayoutInvalidated(nid)
  })

  ipcMain.handle(IPC.GET_DEVICES, (_e, requestedNetworkId?: string | null) => {
    const db = getDatabase()
    if (requestedNetworkId != null && String(requestedNetworkId).trim() !== '') {
      return listDevices(db, normalizeNetworkId(String(requestedNetworkId)))
    }
    return listDevices(db, uiNetworkId())
  })

  ipcMain.handle(IPC.GET_NETWORK_ADAPTERS, () => listNetworkAdapters())

  ipcMain.handle(IPC.GET_DEVICE_GROUPS, () => listDeviceGroups(getDatabase()))

  ipcMain.handle(IPC.SAVE_DEVICE_GROUP, (_e, payload: SaveDeviceGroupPayload) => {
    const g = saveDeviceGroup(getDatabase(), payload)
    pushDeviceGroupsToRenderer()
    mainWindow?.webContents.send(IPC.ON_DEVICES_CHANGED, listDevices(getDatabase(), uiNetworkId()))
    return g
  })

  ipcMain.handle(IPC.DELETE_DEVICE_GROUP, (_e, id: string) => {
    deleteDeviceGroup(getDatabase(), id)
    pushDeviceGroupsToRenderer()
    const payload = listDevices(getDatabase(), uiNetworkId())
    mainWindow?.webContents.send(IPC.ON_DEVICES_CHANGED, payload)
    mapWindow?.webContents.send(IPC.ON_DEVICES_CHANGED, payload)
  })

  ipcMain.handle(IPC.SET_DEVICE_GROUP, (_e, deviceId: string, groupId: string | null) => {
    const d = applyUserSetDeviceGroup(getDatabase(), deviceId, groupId)
    const payload = listDevices(getDatabase(), uiNetworkId())
    mainWindow?.webContents.send(IPC.ON_DEVICES_CHANGED, payload)
    mapWindow?.webContents.send(IPC.ON_DEVICES_CHANGED, payload)
    refreshTray()
    return d
  })

  ipcMain.handle(IPC.SAVE_DEVICE, (_e, payload: SaveDevicePayload) => {
    const d = applyUserSaveDevicePayload(getDatabase(), payload)
    const next = listDevices(getDatabase(), uiNetworkId())
    mainWindow?.webContents.send(IPC.ON_DEVICES_CHANGED, next)
    mapWindow?.webContents.send(IPC.ON_DEVICES_CHANGED, next)
    pushArpToRenderer()
    refreshTray()
    return d
  })

  ipcMain.handle(IPC.DELETE_DEVICE, async (_e, id: string) => {
    await deleteDevice(getDatabase(), id, { source: 'user' })
    const next = listDevices(getDatabase(), uiNetworkId())
    mainWindow?.webContents.send(IPC.ON_DEVICES_CHANGED, next)
    mapWindow?.webContents.send(IPC.ON_DEVICES_CHANGED, next)
    pushArpToRenderer()
    refreshTray()
  })

  /** Debug/maintenance: read-only mirror check (DevTools `window.ssApi.debugVerifyEquipmentMirrorDevice(id)`). */
  ipcMain.handle(IPC.DEBUG_MAINTENANCE_VERIFY_EQUIPMENT_MIRROR_DEVICE, (_e, deviceId: string) =>
    verifyEquipmentValuesMirrorRow(getDatabase(), String(deviceId ?? ''))
  )
  ipcMain.handle(IPC.DEBUG_MAINTENANCE_VERIFY_EQUIPMENT_MIRROR_SCAN, () =>
    verifyAllEquipmentValuesMirrorRows(getDatabase())
  )

  /** Debug/maintenance: JSON hydration experiment + fallback (DevTools `window.ssApi.debugResolveEquipmentRuntimeJsonHydration(id)`). */
  ipcMain.handle(IPC.DEBUG_MAINTENANCE_RESOLVE_EQUIPMENT_RUNTIME_JSON_HYDRATION, (_e, deviceId: string) =>
    debugResolveEquipmentRuntimeProjectionWithJsonHydration(getDatabase(), String(deviceId ?? ''))
  )

  ipcMain.handle(IPC.GET_ARP, () => ({
    entries: listArpEntries(getDatabase(), uiNetworkId()),
    discovered: listDiscoveredDevices(getDatabase(), uiNetworkId())
  }))

  ipcMain.handle(IPC.GET_DISCOVERED, () => listDiscoveredDevices(getDatabase(), uiNetworkId()))

  ipcMain.handle(IPC.DISMISS_DISCOVERED_IP, (_e, ip: string) => {
    dismissDiscoveredIp(getDatabase(), ip)
    pushArpToRenderer()
  })

  ipcMain.handle(IPC.CLEAR_DISMISSED_DISCOVERED, () => {
    clearDismissedDiscovered(getDatabase())
    pushArpToRenderer()
  })

  /** Manual ARP refresh: same work as scheduler’s ARP tick (scan + notify + push). */
  ipcMain.handle(IPC.REFRESH_ARP, async () => {
    const db = getDatabase()
    await scanArpCache(db, eventLogs ?? undefined)
    const settings = getSettings(db)
    const nid = uiNetworkId()
    const discovered = listDiscoveredDevices(db, nid)
    notifyNewUnknownDevices(
      settings,
      discovered.map((d) => d.ip)
    )
    onDiscoveryScanComplete(
      db,
      discovered,
      nid,
      eventLogs ?? undefined
    )
    const payload = {
      entries: listArpEntries(db, nid),
      discovered
    }
    mainWindow?.webContents.send(IPC.ON_ARP_CHANGED, payload)
    mapWindow?.webContents.send(IPC.ON_ARP_CHANGED, payload)
    const devicesPayload = listDevices(db, nid)
    mainWindow?.webContents.send(IPC.ON_DEVICES_CHANGED, devicesPayload)
    mapWindow?.webContents.send(IPC.ON_DEVICES_CHANGED, devicesPayload)
    return payload
  })

  ipcMain.handle(IPC.GET_SETTINGS, () => getSettings(getDatabase()))

  ipcMain.handle(IPC.SAVE_SETTINGS, (_e, partial: Partial<AppSettings>) => {
    const next = saveSettings(getDatabase(), partial)
    eventLogs?.setEventSeverityOverrides(next.eventLogSeverityOverrides)
    if (schedulerRestartTimer) clearTimeout(schedulerRestartTimer)
    schedulerRestartTimer = setTimeout(() => {
      scheduler?.stop()
      scheduler = startScheduler(getDatabase(), mainWindow, {
        onDevicesUpdated: refreshTray,
        getSecondaryWindow: () => mapWindow
      })
      schedulerRestartTimer = null
    }, 250)
    mainWindow?.webContents.send(IPC.ON_SETTINGS_CHANGED, next)
    return next
  })
}

const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.show()
      mainWindow.focus()
    }
  })

  app.whenReady().then(async () => {
    getDatabase()
    eventLogs = new EventLogService(getDatabase(), pushEventToRenderer)
    eventLogs.setEventSeverityOverrides(getSettings(getDatabase()).eventLogSeverityOverrides)
    await ensureInitialNetworkContext()
    const ctx0 = getLastNetworkContext()
    if (ctx0) {
      // Only sync metadata for already-saved profiles. New networks are prompted in the UI.
      syncNetworkProfileFromContext(getDatabase(), ctx0)
    }
    // Register IPC before the window loads the renderer (avoids "No handler registered" races).
    registerIpc()
    createWindow()
    buildMenu()
    tray = createTray(mainWindow!, traySummary)
    scheduler = startScheduler(getDatabase(), mainWindow, {
      onDevicesUpdated: refreshTray,
      eventLogs: eventLogs ?? undefined,
      getSecondaryWindow: () => mapWindow
    })
    networkWatch = startNetworkWatch({
      intervalMs: 12_000,
      onContextSample: (ctx) => {
        // Lightweight bookkeeping only: keep last_seen fresh for known networks.
        syncNetworkProfileFromContext(getDatabase(), ctx)
        pushNetworkInfoUpdated()
      },
      onNetworkChanged: (ctx) => {
        // New LAN after debounce: ensure profile row exists, then refresh monitoring + UI.
        const existing = syncNetworkProfileFromContext(getDatabase(), ctx)
        pushNetworkProfilesToRenderer()
        clearVendorLookupCache()
        resetAlertDiscoveryBaseline()
        scheduler?.stop()
        scheduler = startScheduler(getDatabase(), mainWindow, {
          onDevicesUpdated: refreshTray,
          eventLogs: eventLogs ?? undefined,
          getSecondaryWindow: () => mapWindow
        })
        const info = networkInfoPayload()
        if (!mainWindow || mainWindow.isDestroyed()) return
        if (info) mainWindow.webContents.send(IPC.ON_NETWORK_CHANGED, info)
        mapWindow?.webContents.send(IPC.ON_NETWORK_CHANGED, info)
        const devicesPayload = listDevices(getDatabase(), uiNetworkId())
        mainWindow.webContents.send(IPC.ON_DEVICES_CHANGED, devicesPayload)
        mapWindow?.webContents.send(IPC.ON_DEVICES_CHANGED, devicesPayload)
        const arpPayload = {
          entries: listArpEntries(getDatabase(), uiNetworkId()),
          discovered: listDiscoveredDevices(getDatabase(), uiNetworkId())
        }
        mainWindow.webContents.send(IPC.ON_ARP_CHANGED, arpPayload)
        mapWindow?.webContents.send(IPC.ON_ARP_CHANGED, arpPayload)
        refreshTray()

        eventLogs?.log({
          eventType: 'NETWORK_CHANGED' as EventType,
          networkId: ctx.networkId,
          ssid: ctx.wifiSsid ?? null,
          message: `Network changed to ${ctx.gateway} (${ctx.cidr}).`,
          metadata: { gateway: ctx.gateway, cidr: ctx.cidr }
        })

        // Onboarding: if this LAN isn't saved yet, prompt the user (do not auto-save silently).
        if (!existing) {
          const nid = normalizeNetworkId(ctx.networkId)
          if (nid && !ignoredNewNetworkIds.has(nid)) {
            const suggestedName = ctx.wifiSsid?.trim() ? ctx.wifiSsid.trim() : 'New network'
            const payload: NewNetworkDetectedPayload = {
              networkId: ctx.networkId,
              ssid: ctx.wifiSsid?.trim() || null,
              gateway: ctx.gateway,
              subnet: ctx.cidr,
              suggestedName
            }
            mainWindow.webContents.send(IPC.ON_NEW_NETWORK_DETECTED, payload)

            eventLogs?.log({
              eventType: 'NETWORK_NEW_DETECTED' as EventType,
              networkId: ctx.networkId,
              ssid: ctx.wifiSsid ?? null,
              message: payload.ssid ? `New network detected: ${payload.ssid}` : 'New network detected',
              metadata: payload as unknown as Record<string, unknown>
            })
          }
        }
      }
    })
    pushNetworkProfilesToRenderer()

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow()
      else mainWindow?.show()
    })
  })

  app.on('before-quit', () => {
    isQuitting = true
    if (schedulerRestartTimer) clearTimeout(schedulerRestartTimer)
    networkWatch?.stop()
    networkWatch = null
    scheduler?.stop()
    closeDatabase()
  })

  app.on('window-all-closed', () => {
    /* Tray keeps the app running on Windows/macOS. */
  })
}
