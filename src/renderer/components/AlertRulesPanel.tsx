import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useConfirmAction } from '../confirm/ConfirmDialogContext'
import {
  logDeleteFlowPreDelete,
  recoverKeyboardAfterDestructiveAction
} from '../utils/postDeleteFocusRecovery'
import { getDeviceTypeDisplayLabel } from '@shared/deviceTypeDisplay'
import type {
  AlertConditionType,
  AlertRule,
  AlertRuleConditionConfig,
  Device,
  EventSeverity,
  NetworkProfileListItem,
  SaveAlertRulePayload
} from '@shared/types'

const CONDITION_OPTIONS: { value: AlertConditionType; label: string }[] = [
  { value: 'device_offline', label: 'Device goes offline' },
  { value: 'device_online', label: 'Device comes online' },
  { value: 'new_device_discovered', label: 'New device in ARP cache' },
  { value: 'mac_address_change', label: 'MAC address change (confirmed)' }
]

const SCOPE_OPTIONS = [
  { value: 'all', label: 'Any device / host' },
  { value: 'device', label: 'Specific device (name or IP)' },
  { value: 'group', label: 'Group (vendor, type, or IP prefix)' }
] as const

const GROUP_KIND_OPTIONS = [
  { value: 'vendor', label: 'Vendor (substring)' },
  { value: 'deviceType', label: 'Device type (exact)' },
  { value: 'ipPrefix', label: 'IP prefix (e.g. 192.168.1.)' }
] as const

/** Dropdown value only when form matches a single monitored device (otherwise manual / custom). */
function resolveDevicePickerId(devices: Device[], cfg: AlertRuleConditionConfig): string {
  if (cfg.deviceId) {
    const d = devices.find((x) => x.id === cfg.deviceId)
    if (!d) return ''
    const ip = cfg.deviceIp?.trim()
    if (ip && ip !== d.ip) return ''
    return d.id
  }
  if (cfg.deviceIp?.trim()) {
    const matches = devices.filter((x) => x.ip === cfg.deviceIp!.trim())
    if (matches.length === 1) return matches[0]!.id
  }
  return ''
}

function sortDevicesForPicker(devices: Device[]): Device[] {
  return [...devices].sort((a, b) => a.name.localeCompare(b.name) || a.ip.localeCompare(b.ip))
}

/** User-visible device name for the rule form (stored rule still uses deviceId in JSON). */
function deviceDisplayName(devices: Device[], cfg: AlertRuleConditionConfig): string {
  if (cfg.deviceId) {
    const d = devices.find((x) => x.id === cfg.deviceId)
    if (d) return d.name
  }
  const dip = cfg.deviceIp?.trim()
  if (dip) {
    const matches = devices.filter((x) => x.ip === dip)
    if (matches.length === 1) return matches[0]!.name
  }
  return ''
}

type NameResolve =
  | { kind: 'empty' }
  | { kind: 'one'; device: Device }
  | { kind: 'none' }
  | { kind: 'ambiguous' }

function resolveDeviceNameInput(devices: Device[], nameInput: string): NameResolve {
  const t = nameInput.trim()
  if (!t) return { kind: 'empty' }
  const lower = t.toLowerCase()
  const matches = devices.filter((d) => d.name.trim().toLowerCase() === lower)
  if (matches.length === 1) return { kind: 'one', device: matches[0]! }
  if (matches.length > 1) return { kind: 'ambiguous' }
  return { kind: 'none' }
}

/** Resolves name + IP into conditionConfig for save (deviceId kept in DB, never shown as primary UX). */
function buildResolvedDeviceConfigForSave(
  devices: Device[],
  deviceNameInput: string,
  cfg: AlertRuleConditionConfig
):
  | { ok: true; config: AlertRuleConditionConfig; canonicalName: string }
  | { ok: false; message: string } {
  if ((cfg.scope ?? 'all') !== 'device') {
    return { ok: true, config: cfg, canonicalName: '' }
  }

  const ip = cfg.deviceIp?.trim()
  const nr = resolveDeviceNameInput(devices, deviceNameInput)

  if (nr.kind === 'one') {
    const d = nr.device
    return {
      ok: true,
      config: { ...cfg, scope: 'device', deviceId: d.id, deviceIp: d.ip },
      canonicalName: d.name
    }
  }
  if (nr.kind === 'ambiguous') {
    return { ok: false, message: 'Multiple devices share that name. Pick from the list or use IP.' }
  }
  if (nr.kind === 'none') {
    if (!ip) {
      return { ok: false, message: 'No device matches that name. Enter IP or pick from the list.' }
    }
    return {
      ok: true,
      config: { ...cfg, scope: 'device', deviceId: undefined, deviceIp: cfg.deviceIp },
      canonicalName: ''
    }
  }
  if (!ip) {
    return { ok: false, message: 'Enter a device name, IP, or pick from the list.' }
  }
  return {
    ok: true,
    config: { ...cfg, scope: 'device', deviceId: undefined, deviceIp: cfg.deviceIp },
    canonicalName: ''
  }
}

function emptyForm(): SaveAlertRulePayload {
  return {
    name: '',
    enabled: true,
    networkId: null,
    conditionType: 'device_offline',
    conditionConfig: { scope: 'all' },
    cooldownSeconds: 300,
    eventLogSeverity: null
  }
}

interface AlertRulesPanelProps {
  /** When false, omit the panel heading (e.g. Rules submenu already titles the view). */
  showTitle?: boolean
}

export function AlertRulesPanel({ showTitle = true }: AlertRulesPanelProps): JSX.Element {
  const { confirmAction } = useConfirmAction()
  const api = window.ssApi
  const [rules, setRules] = useState<AlertRule[]>([])
  const [profiles, setProfiles] = useState<NetworkProfileListItem[]>([])
  const [devices, setDevices] = useState<Device[]>([])
  const [form, setForm] = useState<SaveAlertRulePayload>(emptyForm)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [deviceNameInput, setDeviceNameInput] = useState('')
  const deviceNameDirtyRef = useRef(false)

  const load = useCallback(async () => {
    const [r, p, d] = await Promise.all([api.getAlertRules(), api.getNetworkProfiles(), api.getDevices()])
    setRules(r)
    setProfiles(p)
    setDevices(d)
  }, [api])

  useEffect(() => {
    void load().catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)))
  }, [load])

  useEffect(() => {
    const unsub = api.onAlertRulesChanged(setRules)
    return unsub
  }, [api])

  useEffect(() => {
    const unsub = api.onDevicesChanged(setDevices)
    return unsub
  }, [api])

  const cfg = form.conditionConfig
  const scope = cfg.scope ?? 'all'

  useEffect(() => {
    deviceNameDirtyRef.current = false
  }, [editingId, scope])

  useEffect(() => {
    if (scope !== 'device' || deviceNameDirtyRef.current) return
    setDeviceNameInput(deviceDisplayName(devices, cfg))
  }, [scope, cfg.deviceId, cfg.deviceIp, devices, editingId])

  function setCfg(partial: Partial<AlertRuleConditionConfig>): void {
    setForm((f) => ({
      ...f,
      conditionConfig: { ...f.conditionConfig, ...partial }
    }))
  }

  function handleDeviceNameBlur(): void {
    deviceNameDirtyRef.current = false
    const nr = resolveDeviceNameInput(devices, deviceNameInput)
    if (nr.kind === 'one') {
      const d = nr.device
      setCfg({ deviceId: d.id, deviceIp: d.ip })
      setDeviceNameInput(d.name)
      setError(null)
      return
    }
    if (nr.kind === 'ambiguous') {
      setCfg({ deviceId: undefined })
      setError('Multiple devices share that name. Pick from the list or use IP.')
      return
    }
    if (nr.kind === 'none') {
      setCfg({ deviceId: undefined })
      setError(
        deviceNameInput.trim() ? 'No monitored device matches that name. Use IP or the list.' : null
      )
      return
    }
    setCfg({ deviceId: undefined })
    setError(null)
  }

  async function handleSave(): Promise<void> {
    setError(null)
    if (!form.name.trim()) {
      setError('Name is required')
      return
    }
    const resolved = buildResolvedDeviceConfigForSave(devices, deviceNameInput, form.conditionConfig)
    if (!resolved.ok) {
      setError(resolved.message)
      return
    }
    const conditionConfig = resolved.config
    setSaving(true)
    try {
      await api.saveAlertRule({
        ...form,
        conditionConfig,
        id: editingId ?? undefined,
        name: form.name.trim(),
        cooldownSeconds: Math.max(0, Math.floor(Number(form.cooldownSeconds) || 0)),
        eventLogSeverity: form.eventLogSeverity ?? null
      })
      setForm(emptyForm())
      setDeviceNameInput('')
      setEditingId(null)
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete(id: string): Promise<void> {
    const ok = await confirmAction({
      title: 'Delete alert rule?',
      message: 'This rule will be removed. You can create a new one later.',
      confirmLabel: 'Delete',
      cancelLabel: 'Cancel',
      destructive: true
    })
    if (!ok) return
    logDeleteFlowPreDelete('settings:deleteAlertRule')
    await api.deleteAlertRule(id)
    recoverKeyboardAfterDestructiveAction('settings:deleteAlertRule')
    if (editingId === id) {
      setEditingId(null)
      setForm(emptyForm())
      setDeviceNameInput('')
    }
    await load()
  }

  async function toggleEnabled(rule: AlertRule): Promise<void> {
    await api.saveAlertRule({
      id: rule.id,
      name: rule.name,
      enabled: !rule.enabled,
      networkId: rule.networkId,
      conditionType: rule.conditionType,
      conditionConfig: rule.conditionConfig,
      cooldownSeconds: rule.cooldownSeconds,
      eventLogSeverity: rule.eventLogSeverity
    })
    await load()
  }

  function startEdit(rule: AlertRule): void {
    deviceNameDirtyRef.current = false
    setEditingId(rule.id)
    setForm({
      name: rule.name,
      enabled: rule.enabled,
      networkId: rule.networkId,
      conditionType: rule.conditionType,
      conditionConfig: { ...rule.conditionConfig },
      cooldownSeconds: rule.cooldownSeconds,
      eventLogSeverity: rule.eventLogSeverity ?? null
    })
    setDeviceNameInput(deviceDisplayName(devices, rule.conditionConfig))
    setError(null)
  }

  const devicesSorted = useMemo(() => sortDevicesForPicker(devices), [devices])
  const devicePickerId = useMemo(
    () => resolveDevicePickerId(devices, cfg),
    [devices, cfg.deviceId, cfg.deviceIp]
  )

  return (
    <div className="settings-section alert-rules-section">
      {showTitle ? <h3 className="settings-subheading">Alert rules</h3> : null}
      <p className="muted">
        Custom desktop notifications. Legacy &quot;notify on offline&quot; / &quot;new ARP host&quot; toggles are under
        Settings → General. Rules respect network scope and cooldown. New device alerts ignore the first ARP snapshot
        after app start or after you switch networks.
      </p>

      {error ? <p className="error">{error}</p> : null}

      <div className="alert-rules-form">
        <label>
          Rule name
          <input
            type="text"
            value={form.name}
            onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
            placeholder="e.g. Printer offline"
          />
        </label>
        <label className="u-label-inline">
          <input
            type="checkbox"
            checked={form.enabled}
            onChange={(e) => setForm((f) => ({ ...f, enabled: e.target.checked }))}
          />
          Enabled
        </label>
        <label>
          When
          <select
            value={form.conditionType}
            onChange={(e) =>
              setForm((f) => ({ ...f, conditionType: e.target.value as AlertConditionType }))
            }
          >
            {CONDITION_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          Network (optional)
          <select
            value={form.networkId ?? ''}
            onChange={(e) =>
              setForm((f) => ({
                ...f,
                networkId: e.target.value === '' ? null : e.target.value
              }))
            }
          >
            <option value="">All networks</option>
            {profiles.map((p) => (
              <option key={p.id} value={p.networkId}>
                {p.name} ({p.subnet || p.networkId})
              </option>
            ))}
          </select>
        </label>
        <label>
          Match
          <select
            value={scope}
            onChange={(e) => {
              const v = e.target.value as 'all' | 'device' | 'group'
              deviceNameDirtyRef.current = false
              setDeviceNameInput('')
              setCfg({
                scope: v,
                deviceId: undefined,
                deviceIp: undefined,
                groupKind: undefined,
                groupValue: undefined
              })
            }}
          >
            {SCOPE_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
        {scope === 'device' ? (
          <>
            <label className="alert-rules-form__full-row">
              Monitored device
              <select
                value={devicePickerId}
                onChange={(e) => {
                  deviceNameDirtyRef.current = false
                  const id = e.target.value
                  if (!id) {
                    setCfg({ deviceId: undefined, deviceIp: undefined })
                    setDeviceNameInput('')
                    return
                  }
                  const d = devices.find((x) => x.id === id)
                  if (d) {
                    setCfg({ deviceId: d.id, deviceIp: d.ip })
                    setDeviceNameInput(d.name)
                  }
                }}
              >
                <option value="">— Select from list (or enter name / IP below) —</option>
                {devicesSorted.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name} ({d.ip})
                    {` · ${getDeviceTypeDisplayLabel(d)}`}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Device name (optional)
              <input
                type="text"
                value={deviceNameInput}
                onChange={(e) => {
                  deviceNameDirtyRef.current = true
                  setDeviceNameInput(e.target.value)
                }}
                onBlur={handleDeviceNameBlur}
                placeholder="e.g. Office Printer"
              />
            </label>
            <label>
              Device IP (optional)
              <input
                type="text"
                value={cfg.deviceIp ?? ''}
                onChange={(e) => setCfg({ deviceIp: e.target.value || undefined })}
                onBlur={() => {
                  if (deviceNameDirtyRef.current) return
                  setDeviceNameInput(deviceDisplayName(devices, cfg))
                }}
                placeholder="192.168.1.10"
              />
            </label>
          </>
        ) : null}
        {scope === 'group' ? (
          <>
            <label>
              Group by
              <select
                value={cfg.groupKind ?? 'vendor'}
                onChange={(e) =>
                  setCfg({ groupKind: e.target.value as 'vendor' | 'deviceType' | 'ipPrefix' })
                }
              >
                {GROUP_KIND_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Value
              <input
                type="text"
                value={cfg.groupValue ?? ''}
                onChange={(e) => setCfg({ groupValue: e.target.value || undefined })}
                placeholder="Apple / Printer / 10.0.0."
              />
            </label>
          </>
        ) : null}
        <label>
          Cooldown (seconds)
          <input
            type="number"
            min={0}
            value={form.cooldownSeconds}
            onChange={(e) =>
              setForm((f) => ({ ...f, cooldownSeconds: Number(e.target.value) || 0 }))
            }
          />
        </label>
        <label>
          Event log severity (when this rule fires)
          <select
            value={form.eventLogSeverity ?? ''}
            onChange={(e) => {
              const v = e.target.value
              setForm((f) => ({
                ...f,
                eventLogSeverity: v === '' ? null : (v as EventSeverity)
              }))
            }}
          >
            <option value="">Default (global override + built-in)</option>
            <option value="info">Info</option>
            <option value="warning">Warning</option>
            <option value="critical">Critical</option>
          </select>
        </label>
        <div className="settings-purge-actions">
          <button type="button" disabled={saving} onClick={() => void handleSave()}>
            {saving ? 'Saving…' : editingId ? 'Update rule' : 'Add rule'}
          </button>
          {editingId ? (
            <button
              type="button"
              className="secondary"
              onClick={() => {
                deviceNameDirtyRef.current = false
                setEditingId(null)
                setForm(emptyForm())
                setDeviceNameInput('')
                setError(null)
              }}
            >
              Cancel edit
            </button>
          ) : null}
        </div>
      </div>

      <div className="table-wrap u-table-wrap-mt">
        <table>
          <thead>
            <tr>
              <th>Name</th>
              <th>Type</th>
              <th>Log severity</th>
              <th>Enabled</th>
              <th>Last triggered</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {rules.length === 0 ? (
              <tr>
                <td colSpan={6} className="muted">
                  No alert rules yet.
                </td>
              </tr>
            ) : (
              rules.map((r) => (
                <tr key={r.id}>
                  <td>{r.name}</td>
                  <td className="muted">{CONDITION_OPTIONS.find((x) => x.value === r.conditionType)?.label ?? r.conditionType}</td>
                  <td className="muted">
                    {r.eventLogSeverity ?? 'Default'}
                  </td>
                  <td>
                    <button type="button" className="secondary" onClick={() => void toggleEnabled(r)}>
                      {r.enabled ? 'On' : 'Off'}
                    </button>
                  </td>
                  <td className="muted">
                    {r.lastTriggered ? new Date(r.lastTriggered).toLocaleString() : '—'}
                  </td>
                  <td>
                    <div className="u-flex-row-wrap-sm">
                      <button type="button" className="secondary" onClick={() => startEdit(r)}>
                        Edit
                      </button>
                      <button type="button" className="danger" onClick={() => void handleDelete(r.id)}>
                        Delete
                      </button>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
