import { contextBridge, ipcRenderer } from 'electron'
import { IPC } from '@shared/ipc'
import type {
  AlertRule,
  AppSettings,
  ArpEntry,
  CreateMapManualGroupPayload,
  Device,
  DeviceGroup,
  MapLayoutBundle,
  MapManualGroup,
  NetworkAdapter,
  NetworkInfo,
  NetworkProfile,
  NetworkProfileListItem,
  NewNetworkDetectedPayload,
  PurgeDeviceCachePayload,
  PurgeDeviceCacheResult,
  CreateNetworkProfilePayload,
  RenameMapManualGroupPayload,
  RenameNetworkProfilePayload,
  SaveAlertRulePayload,
  SaveDeviceGroupPayload,
  SaveDevicePayload,
  MapLayoutSavePayload
} from '@shared/types'

export interface ArpPayload {
  entries: ArpEntry[]
  discovered: ArpEntry[]
}

const api = {
  getDevices: (networkId?: string | null): Promise<Device[]> =>
    ipcRenderer.invoke(IPC.GET_DEVICES, networkId ?? undefined),
  getNetworkAdapters: (): Promise<NetworkAdapter[]> =>
    ipcRenderer.invoke(IPC.GET_NETWORK_ADAPTERS),
  saveDevice: (payload: SaveDevicePayload): Promise<Device> =>
    ipcRenderer.invoke(IPC.SAVE_DEVICE, payload),
  deleteDevice: (id: string): Promise<void> => ipcRenderer.invoke(IPC.DELETE_DEVICE, id),
  getDeviceGroups: (): Promise<DeviceGroup[]> => ipcRenderer.invoke(IPC.GET_DEVICE_GROUPS),
  saveDeviceGroup: (payload: SaveDeviceGroupPayload): Promise<DeviceGroup> =>
    ipcRenderer.invoke(IPC.SAVE_DEVICE_GROUP, payload),
  deleteDeviceGroup: (id: string): Promise<void> =>
    ipcRenderer.invoke(IPC.DELETE_DEVICE_GROUP, id),
  setDeviceGroup: (deviceId: string, groupId: string | null): Promise<Device> =>
    ipcRenderer.invoke(IPC.SET_DEVICE_GROUP, deviceId, groupId),
  getArp: (): Promise<ArpPayload> => ipcRenderer.invoke(IPC.GET_ARP),
  getDiscovered: (): Promise<ArpEntry[]> => ipcRenderer.invoke(IPC.GET_DISCOVERED),
  refreshArp: (): Promise<ArpPayload> => ipcRenderer.invoke(IPC.REFRESH_ARP),
  dismissDiscoveredIp: (ip: string): Promise<void> =>
    ipcRenderer.invoke(IPC.DISMISS_DISCOVERED_IP, ip),
  clearDismissedDiscovered: (): Promise<void> =>
    ipcRenderer.invoke(IPC.CLEAR_DISMISSED_DISCOVERED),
  getNetworkInfo: (): Promise<NetworkInfo | null> =>
    ipcRenderer.invoke(IPC.GET_NETWORK_INFO),
  getNetworkProfiles: (): Promise<NetworkProfileListItem[]> =>
    ipcRenderer.invoke(IPC.GET_NETWORK_PROFILES),
  createNetworkProfile: (payload: CreateNetworkProfilePayload): Promise<NetworkProfile> =>
    ipcRenderer.invoke(IPC.CREATE_NETWORK_PROFILE, payload),
  renameNetworkProfile: (payload: RenameNetworkProfilePayload): Promise<NetworkProfile> =>
    ipcRenderer.invoke(IPC.RENAME_NETWORK_PROFILE, payload),
  deleteNetworkProfile: (id: string): Promise<void> =>
    ipcRenderer.invoke(IPC.DELETE_NETWORK_PROFILE, id),
  ignoreNewNetwork: (networkId: string): Promise<void> =>
    ipcRenderer.invoke(IPC.IGNORE_NEW_NETWORK, networkId),
  purgeDeviceCache: (payload: PurgeDeviceCachePayload): Promise<PurgeDeviceCacheResult> =>
    ipcRenderer.invoke(IPC.PURGE_DEVICE_CACHE, payload),
  getAlertRules: (): Promise<AlertRule[]> => ipcRenderer.invoke(IPC.GET_ALERT_RULES),
  saveAlertRule: (payload: SaveAlertRulePayload): Promise<AlertRule> =>
    ipcRenderer.invoke(IPC.SAVE_ALERT_RULE, payload),
  deleteAlertRule: (id: string): Promise<boolean> => ipcRenderer.invoke(IPC.DELETE_ALERT_RULE, id),
  getMapLayout: (networkId: string): Promise<MapLayoutBundle> =>
    ipcRenderer.invoke(IPC.GET_MAP_LAYOUT, networkId),
  saveMapLayout: (payload: MapLayoutSavePayload): Promise<void> =>
    ipcRenderer.invoke(IPC.SAVE_MAP_LAYOUT, payload),
  resetMapLayout: (networkId: string): Promise<void> =>
    ipcRenderer.invoke(IPC.RESET_MAP_LAYOUT, networkId),
  createMapManualGroup: (payload: CreateMapManualGroupPayload): Promise<MapManualGroup> =>
    ipcRenderer.invoke(IPC.CREATE_MAP_MANUAL_GROUP, payload),
  renameMapManualGroup: (payload: RenameMapManualGroupPayload): Promise<void> =>
    ipcRenderer.invoke(IPC.RENAME_MAP_MANUAL_GROUP, payload),
  deleteMapManualGroup: (id: string): Promise<void> =>
    ipcRenderer.invoke(IPC.DELETE_MAP_MANUAL_GROUP, id),
  focusBrowserWindowForKeyboard: (context?: string): Promise<void> =>
    ipcRenderer.invoke(IPC.FOCUS_BROWSER_WINDOW_FOR_KEYBOARD, context ?? ''),
  getEventLogs: (query?: import('@shared/types').GetEventLogsQuery): Promise<import('@shared/types').EventLog[]> =>
    ipcRenderer.invoke(IPC.GET_EVENT_LOGS, query ?? {}),
  clearEventLogs: (payload: import('@shared/types').ClearEventLogsPayload): Promise<import('@shared/types').ClearEventLogsResult> =>
    ipcRenderer.invoke(IPC.CLEAR_EVENT_LOGS, payload),
  exportEventLogs: (payload: import('@shared/types').ExportEventLogsPayload): Promise<import('@shared/types').ExportEventLogsResult> =>
    ipcRenderer.invoke(IPC.EXPORT_EVENT_LOGS, payload),
  getSettings: (): Promise<AppSettings> => ipcRenderer.invoke(IPC.GET_SETTINGS),
  saveSettings: (partial: Partial<AppSettings>): Promise<AppSettings> =>
    ipcRenderer.invoke(IPC.SAVE_SETTINGS, partial),
  onDevicesChanged: (cb: (devices: Device[]) => void): (() => void) => {
    const handler = (_e: import('electron').IpcRendererEvent, devices: Device[]): void => {
      cb(devices)
    }
    ipcRenderer.on(IPC.ON_DEVICES_CHANGED, handler)
    return () => ipcRenderer.removeListener(IPC.ON_DEVICES_CHANGED, handler)
  },
  onArpChanged: (cb: (payload: ArpPayload) => void): (() => void) => {
    const handler = (_e: import('electron').IpcRendererEvent, payload: ArpPayload): void => {
      cb(payload)
    }
    ipcRenderer.on(IPC.ON_ARP_CHANGED, handler)
    return () => ipcRenderer.removeListener(IPC.ON_ARP_CHANGED, handler)
  },
  onSettingsChanged: (cb: (s: AppSettings) => void): (() => void) => {
    const handler = (_e: import('electron').IpcRendererEvent, s: AppSettings): void => {
      cb(s)
    }
    ipcRenderer.on(IPC.ON_SETTINGS_CHANGED, handler)
    return () => ipcRenderer.removeListener(IPC.ON_SETTINGS_CHANGED, handler)
  },
  onDeviceGroupsChanged: (cb: (groups: DeviceGroup[]) => void): (() => void) => {
    const handler = (_e: import('electron').IpcRendererEvent, groups: DeviceGroup[]): void => {
      cb(groups)
    }
    ipcRenderer.on(IPC.ON_DEVICE_GROUPS_CHANGED, handler)
    return () => ipcRenderer.removeListener(IPC.ON_DEVICE_GROUPS_CHANGED, handler)
  },
  onShowSettings: (cb: () => void): (() => void) => {
    const handler = (): void => cb()
    ipcRenderer.on(IPC.SHOW_SETTINGS, handler)
    return () => ipcRenderer.removeListener(IPC.SHOW_SETTINGS, handler)
  },
  onNetworkChanged: (cb: (info: NetworkInfo) => void): (() => void) => {
    const handler = (_e: import('electron').IpcRendererEvent, info: NetworkInfo): void => {
      cb(info)
    }
    ipcRenderer.on(IPC.ON_NETWORK_CHANGED, handler)
    return () => ipcRenderer.removeListener(IPC.ON_NETWORK_CHANGED, handler)
  },
  onNetworkProfilesChanged: (cb: (profiles: NetworkProfileListItem[]) => void): (() => void) => {
    const handler = (_e: import('electron').IpcRendererEvent, profiles: NetworkProfileListItem[]): void => {
      cb(profiles)
    }
    ipcRenderer.on(IPC.ON_NETWORK_PROFILES_CHANGED, handler)
    return () => ipcRenderer.removeListener(IPC.ON_NETWORK_PROFILES_CHANGED, handler)
  },
  onNetworkInfoUpdated: (cb: (info: NetworkInfo | null) => void): (() => void) => {
    const handler = (_e: import('electron').IpcRendererEvent, info: NetworkInfo | null): void => {
      cb(info)
    }
    ipcRenderer.on(IPC.ON_NETWORK_INFO_UPDATED, handler)
    return () => ipcRenderer.removeListener(IPC.ON_NETWORK_INFO_UPDATED, handler)
  },
  onNewNetworkDetected: (cb: (payload: NewNetworkDetectedPayload) => void): (() => void) => {
    const handler = (_e: import('electron').IpcRendererEvent, payload: NewNetworkDetectedPayload): void => {
      cb(payload)
    }
    ipcRenderer.on(IPC.ON_NEW_NETWORK_DETECTED, handler)
    return () => ipcRenderer.removeListener(IPC.ON_NEW_NETWORK_DETECTED, handler)
  },
  onAlertRulesChanged: (cb: (rules: AlertRule[]) => void): (() => void) => {
    const handler = (_e: import('electron').IpcRendererEvent, rules: AlertRule[]): void => {
      cb(rules)
    }
    ipcRenderer.on(IPC.ON_ALERT_RULES_CHANGED, handler)
    return () => ipcRenderer.removeListener(IPC.ON_ALERT_RULES_CHANGED, handler)
  }
  ,
  onEventLogAdded: (cb: (ev: import('@shared/types').EventLog) => void): (() => void) => {
    const handler = (_e: import('electron').IpcRendererEvent, ev: import('@shared/types').EventLog): void => cb(ev)
    ipcRenderer.on(IPC.ON_EVENT_LOG_ADDED, handler)
    return () => ipcRenderer.removeListener(IPC.ON_EVENT_LOG_ADDED, handler)
  }
}

contextBridge.exposeInMainWorld('ssApi', api)

export type SystemStatusApi = typeof api
