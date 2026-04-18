/** Shared types for devices, ARP cache rows, settings, and IPC payloads. */

export type DeviceStatus = 'online' | 'offline' | 'unknown'

export type DeviceType = 'Router' | 'Laptop' | 'Phone' | 'Printer' | 'IoT' | 'Unknown'

export interface DeviceGroup {
  id: string
  name: string
  sortOrder: number
}

export interface SaveDeviceGroupPayload {
  id?: string
  name: string
}

export interface SaveDevicePayload {
  id?: string
  name: string
  ip: string
  subnet: string
  gateway: string
  /** Omit on save to leave unchanged; explicit `null` clears the group. */
  groupId?: string | null
  /**
   * Optional inferred type on **create** (`id` omitted). Persisted to `device_type`; when omitted,
   * insert uses the DB default (`Unknown`).
   */
  deviceType?: DeviceType
  /**
   * Optional display-only type override. Omit on update to leave DB unchanged;
   * `null` clears so the inferred `device_type` is shown again.
   */
  deviceTypeCustom?: string | null
}

export interface Device {
  id: string
  name: string
  ip: string
  subnet: string
  gateway: string
  macAddress: string | null
  /** IEEE OUI vendor from MAC when known (computed in main; not stored separately). */
  vendor: string | null
  deviceType: DeviceType
  /**
   * Optional user label (e.g. when inferred type stays Unknown after ARP).
   * When set, UI and “device type” alert rules use this instead of `deviceType`.
   */
  deviceTypeCustom: string | null
  lastStatus: DeviceStatus
  lastChecked: string | null
  groupId: string | null
  groupName: string | null
  /** LAN fingerprint when tagged; used for alert rules / filtering. */
  networkId?: string | null
  /**
   * Dev main builds only (`NODE_ENV === 'development'`): persisted equipment mirror JSON for diagnostics.
   * Omitted in production IPC. Never authoritative — columns remain source of truth.
   */
  equipmentValuesJson?: string | null
}

export interface ArpEntry {
  id: string
  ip: string
  macAddress: string
  vendor: string | null
  lastSeen: string
  /** LAN fingerprint (`gateway|CIDR`) when the row is tagged; omitted on older rows. */
  networkId?: string | null
  /** From `network_profiles` when joined (discovered list). */
  networkProfileName?: string | null
  /** CIDR from profile, e.g. `192.168.1.0/24`. */
  networkSubnetLabel?: string | null
}

export interface NetworkAdapterAddress {
  address: string
  netmask: string
  family: 'IPv4' | 'IPv6'
  internal: boolean
}

export interface NetworkAdapter {
  /** OS interface name, e.g. "Ethernet", "Wi-Fi", "en0". */
  name: string
  addresses: NetworkAdapterAddress[]
}

/** Current default-route LAN fingerprint (gateway + local IPv4 + subnet → CIDR). */
export interface NetworkInfo {
  networkId: string
  cidr: string
  gateway: string
  localIpv4: string
  netmask: string
  /** Wi‑Fi SSID when available (Windows/macOS only). */
  wifiSsid?: string | null
  /** Set when a `network_profiles` row exists for this fingerprint. */
  profileId?: string
  profileName?: string
  profileLastSeen?: string
}

/** Persisted row in `network_profiles` (friendly name + metadata for one `networkId`). */
export interface NetworkProfile {
  id: string
  networkId: string
  name: string
  /** Wi‑Fi SSID observed when this profile was created/last seen (read-only; may be null). */
  ssid?: string | null
  gateway: string
  /** CIDR string, same as live `NetworkInfo.cidr` when last seen. */
  subnet: string
  firstSeen: string
  lastSeen: string
  settingsJson: string | null
}

/** List row with UI helpers (counts + highlight current LAN). */
export interface NetworkProfileListItem extends NetworkProfile {
  deviceCount: number
  isActive: boolean
}

/** Future: optional overrides merged with global `AppSettings` when on this LAN (not applied yet). */
export interface NetworkProfileSettingsOverrides {
  pingIntervalMs?: number
  arpIntervalMs?: number
  notifyOnOffline?: boolean
  notifyOnNewDevice?: boolean
}

export interface RenameNetworkProfilePayload {
  id: string
  name: string
}

export interface CreateNetworkProfilePayload {
  networkId: string
  name: string
  /** Optional; stored as read-only metadata. */
  ssid?: string | null
  gateway?: string
  subnet?: string
}

export interface NewNetworkDetectedPayload {
  networkId: string
  ssid: string | null
  gateway: string
  subnet: string
  suggestedName: string
}

export type EventType =
  | 'DEVICE_ONLINE'
  | 'DEVICE_OFFLINE'
  | 'DEVICE_DISCOVERED'
  | 'MAC_ADDRESS_CHANGED'
  | 'NETWORK_CHANGED'
  | 'NETWORK_NEW_DETECTED'
  | 'ALERT_TRIGGERED'
  | 'SYSTEM_ERROR'

export type EventSeverity = 'info' | 'warning' | 'critical'

/** User overrides for built-in event types (empty = all defaults). Not used for per-instance overrides. */
export type EventLogSeverityOverrides = Partial<Record<EventType, EventSeverity>>

export interface EventLog {
  id: string
  timestamp: string
  eventType: EventType
  severity: EventSeverity
  deviceId: string | null
  ipAddress: string | null
  macAddress: string | null
  /** Source of truth for scoping/identity. */
  networkId: string
  /** Context only (may be null / duplicated across networks). */
  ssid: string | null
  message: string
  metadata: Record<string, unknown>
}

export interface LogEventInput {
  eventType: EventType
  timestamp?: string
  deviceId?: string | null
  ipAddress?: string | null
  macAddress?: string | null
  /** Required for correct scoping; never inferred from SSID. */
  networkId: string
  ssid?: string | null
  message?: string
  metadata?: Record<string, unknown>
  /**
   * Optional severity from the alert rule when `eventType === ALERT_TRIGGERED`.
   * Final severity is always resolved inside EventLogService (rule → global type overrides → defaults).
   */
  ruleSeverityOverride?: EventSeverity | null
}

export interface GetEventLogsQuery {
  networkId?: string | null
  eventType?: EventType | null
  severity?: EventSeverity | null
  limit?: number
}

export interface ClearEventLogsPayload {
  /** When omitted/null, clears across all networks (including `network_unknown`). */
  query?: Omit<GetEventLogsQuery, 'limit'>
}

export interface ClearEventLogsResult {
  rowsDeleted: number
}

export type ExportEventLogsFormat = 'csv' | 'json'

export interface ExportEventLogsPayload {
  format: ExportEventLogsFormat
  /** When omitted/null, exports across all networks (including `network_unknown`). */
  query?: Omit<GetEventLogsQuery, 'limit'>
}

export interface ExportEventLogsResult {
  /** Null when user cancels save dialog. */
  savedPath: string | null
  rowsExported: number
}

export type PurgeDeviceCacheScope = 'current_network' | 'all'

export interface PurgeDeviceCachePayload {
  scope: PurgeDeviceCacheScope
  /** Also remove ARP rows for the same scope. Clears dismissed discovered IPs when scope is `all`. */
  includeArp?: boolean
}

export interface PurgeDeviceCacheResult {
  devicesRemoved: number
  arpRemoved: number
}

/** Built-in alert rule kinds; add new enum values + engine handler to extend. */
export type AlertConditionType =
  | 'device_offline'
  | 'device_online'
  | 'new_device_discovered'
  | 'mac_address_change'

/**
 * JSON `condition_config` for alert rules.
 * `scope`: `all` = any matching event on the LAN; `device` = one saved host; `group` = vendor / type / IP prefix.
 */
export interface AlertRuleConditionConfig {
  scope?: 'all' | 'device' | 'group'
  deviceId?: string
  deviceIp?: string
  groupKind?: 'vendor' | 'deviceType' | 'ipPrefix'
  /** Case-insensitive match for vendor; exact for deviceType; prefix for ipPrefix (e.g. 192.168.1.) */
  groupValue?: string
}

export interface AlertRule {
  id: string
  name: string
  enabled: boolean
  /** When null/empty, rule applies on every network (still evaluated in current context). */
  networkId: string | null
  conditionType: AlertConditionType
  conditionConfig: AlertRuleConditionConfig
  lastTriggered: string | null
  cooldownSeconds: number
  /**
   * When set, `ALERT_TRIGGERED` log rows for this rule use this severity (resolved in EventLogService).
   * `null` = follow global event-type override for ALERT_TRIGGERED, then built-in default.
   */
  eventLogSeverity: EventSeverity | null
}

export interface SaveAlertRulePayload {
  id?: string
  name: string
  enabled: boolean
  /** Omit or null/empty for global (all networks). */
  networkId?: string | null
  conditionType: AlertConditionType
  conditionConfig: AlertRuleConditionConfig
  cooldownSeconds: number
  /** Omit or null = default (layered resolution for ALERT_TRIGGERED in EventLogService). */
  eventLogSeverity?: EventSeverity | null
}

/** Map View node position; `nodeKey` is device id or `__gateway__` (gateway is never grouped). */
export interface MapLayoutPositionInput {
  nodeKey: string
  x: number
  y: number
  /** Manual group membership; `null` / omit = unassigned (see `map_manual_groups`). */
  manualGroupId?: string | null
  /**
   * Manual layout only: compact device card on the map. Omitted/false = expanded.
   * Gateway rows should omit or set false.
   */
  mapDeviceCollapsed?: boolean
}

export interface MapLayoutSavePayload {
  networkId: string
  positions: MapLayoutPositionInput[]
  /** When set, updates bounds/name for these groups (same `networkId` only); does not delete missing rows. */
  manualGroupLayouts?: MapManualGroupLayoutInput[]
}

/** Persisted coordinates are always absolute flow space; `manualGroupId` records membership. */
export type MapLayoutSnapshot = Record<
  string,
  { x: number; y: number; manualGroupId?: string | null; mapDeviceCollapsed?: boolean }
>

/**
 * User-drawn map container (Phase 2A). Not list `device_groups`, not future auto-clusters.
 * Scoped by `networkId` so groups never leak across LANs.
 */
export interface MapManualGroup {
  id: string
  networkId: string
  name: string
  x: number
  y: number
  width: number
  height: number
  contentsLocked: boolean
  createdAt: string
  updatedAt: string
}

export interface MapManualGroupLayoutInput {
  id: string
  name: string
  x: number
  y: number
  width: number
  height: number
}

export interface MapLayoutBundle {
  manualGroups: MapManualGroup[]
  positions: MapLayoutSnapshot
}

/** User-authored connection line on the map (POC); orthogonal to automatic gateway→device edges. */
export type MapManualTraceConnectionType = 'Power' | 'DMX' | 'Network'

/** One vertex in flow-space for a persisted manual trace polyline. */
export interface MapTracePoint2D {
  x: number
  y: number
}

/**
 * Manual trace for a logical device-to-device link (`source` → `destination`) with typed connection.
 * Snap point ids are opaque placeholders until snap authoring exists; they still anchor endpoints in data.
 *
 * Precedence (future): at most one row per `(networkId, sourceDeviceId, destinationDeviceId, connectionType)`
 * in SQLite — consumers can prefer that row over any automatic geometry for the same logical key.
 */
export interface MapManualTrace {
  readonly kind: 'manual'
  traceId: string
  /** Same scoping as `map_layout_positions` / map surfaces. */
  networkId: string
  sourceDeviceId: string
  destinationDeviceId: string
  connectionType: MapManualTraceConnectionType
  sourceSnapPointId: string
  destinationSnapPointId: string
  path: MapTracePoint2D[]
}

/** IPC payload to upsert one manual trace row (POC). */
export interface SaveMapManualTracePayload {
  networkId: string
  sourceDeviceId: string
  destinationDeviceId: string
  connectionType: MapManualTraceConnectionType
  sourceSnapPointId: string
  destinationSnapPointId: string
  path: MapTracePoint2D[]
}

export interface CreateMapManualGroupPayload {
  networkId: string
  name: string
  x: number
  y: number
  width: number
  height: number
}

export interface RenameMapManualGroupPayload {
  id: string
  name: string
}

export interface SetMapManualGroupLockPayload {
  id: string
  locked: boolean
}

export interface MapManualGroupLockChangedPayload {
  id: string
  locked: boolean
}

/** Dispatched from the native group context menu (main → renderer) to run layout helpers. */
export interface MapManualGroupLayoutActionPayload {
  action: 'autoSize' | 'autoAlign'
  groupId: string
}

/** Main → renderer: SQLite map layout for this network was mutated; reload with getMapLayout. */
export interface MapLayoutInvalidatedPayload {
  networkId: string
}

/** Main → renderer: cross-window shared selection changed (equipment ids only). */
export interface SelectedEquipmentIdsChangedPayload {
  selectedEquipmentIds: string[]
}

export type MapNodeContextMenuTarget =
  | { kind: 'manualGroup'; id: string; contentsLocked: boolean }
  | { kind: 'device'; id: string }

export interface ShowMapNodeContextMenuPayload {
  /** Screen coordinates in CSS pixels. */
  x: number
  y: number
  target: MapNodeContextMenuTarget
}

/** `mirror_os`: SQLite tracks the OS ARP table (rows drop when OS drops). `app_owned`: merge discoveries and age out by TTL. */
export type ArpCacheMode = 'mirror_os' | 'app_owned'

export interface AppSettings {
  pingIntervalMs: number
  arpIntervalMs: number
  notifyOnOffline: boolean
  notifyOnNewDevice: boolean
  /**
   * When empty, monitoring/discovery is disabled (no adapters selected).
   * Values are OS interface names as returned by `os.networkInterfaces()`.
   */
  listenAdapterNames: string[]
  /** When true, use TCP connect attempts as a lightweight fallback when ICMP is blocked. */
  arpTcpTouch: boolean
  arpCacheMode: ArpCacheMode
  /** app_owned: remove rows whose last_seen is older than this (ms). */
  arpEntryTtlMs: number
  /** app_owned: ICMP-scan LAN hosts (from saved devices’ IP + netmask) before reading the neighbor table. */
  arpSubnetSweep: boolean
  /** Global overrides for built-in `EventType` → severity; empty object = use built-in mapping only. */
  eventLogSeverityOverrides: EventLogSeverityOverrides
}

/**
 * Debug/maintenance only: compare `devices.equipment_values_json` to `mapDeviceToEquipmentRuntime(device)`.
 * Exposed via IPC for DevTools / on-demand checks; not used in normal UI flows.
 */
/**
 * Opt-in JSON mirror hydration experiment (debug/maintenance): which path produced the projection.
 * `device_columns` = fallback from authoritative `Device`; `json_mirror_experiment` = validated mirror only.
 */
export type EquipmentRuntimeReadSource = 'device_columns' | 'json_mirror_experiment'

/** IPC-serializable projection payload for {@link DebugEquipmentRuntimeJsonHydrationIpcResult} (maintenance only). */
export interface EquipmentRuntimeProjectionIpcShape {
  id: string
  values: Record<string, unknown>
  _projection: { source: 'legacy_device_row' | 'json_mirror_experiment'; phase: 1 }
}

/** Debug IPC: resolve runtime projection with JSON hydration attempt + explicit fallback (read-only). */
export type DebugEquipmentRuntimeJsonHydrationIpcResult =
  | { ok: false; deviceId: string; reason: string }
  | {
      ok: true
      deviceId: string
      readSource: EquipmentRuntimeReadSource
      projection: EquipmentRuntimeProjectionIpcShape
    }

/** Guarded JSON-read experiment (maintenance only): parse mirror + compare parsed `values` to live projection. */
export interface EquipmentMirrorJsonReadExperiment {
  mirrorParseOk: boolean
  parseFailureReason?: string
  mirrorVersion?: number
  /**
   * Parsed mirror `values` vs `mapDeviceToEquipmentRuntime(device).values` (canonical JSON compare).
   * Always false if parse failed or `device` was unavailable for comparison.
   */
  parsedValuesMatchLiveProjection: boolean
}

export interface EquipmentMirrorVerifyDeviceResult {
  deviceId: string
  ok: boolean
  reason?: string
  /** Secondary: structured parse/compare; authoritative check remains string `ok` vs live serialize. */
  jsonReadExperiment?: EquipmentMirrorJsonReadExperiment
}

/** Debug/maintenance: full-table mirror scan summary (`verifyEquipmentMirrorScan` IPC). */
export interface EquipmentMirrorVerifyScanSummary {
  total: number
  ok: number
  missingOrEmpty: number
  invalid: number
  mismatch: number
  /** e.g. `device_not_found`, `row_not_found`, `device_id_required` */
  other: number
  /** Sample of failing rows (capped) for quick inspection. */
  failures: { deviceId: string; reason?: string }[]
}

export const DEFAULT_SETTINGS: AppSettings = {
  pingIntervalMs: 5000,
  arpIntervalMs: 45000,
  notifyOnOffline: true,
  notifyOnNewDevice: true,
  listenAdapterNames: [],
  arpTcpTouch: false,
  arpCacheMode: 'mirror_os',
  arpEntryTtlMs: 7 * 24 * 60 * 60 * 1000,
  arpSubnetSweep: false,
  eventLogSeverityOverrides: {}
}
