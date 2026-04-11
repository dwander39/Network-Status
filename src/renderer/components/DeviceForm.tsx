import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { prepareAppWindowForKeyboardInput } from '../utils/ensureTextFieldFocus'
import { reportTextEntrySurfaceOpened } from '../utils/postDeleteFocusRecovery'
import { DEVICE_TYPE_CUSTOM_MAX_LEN } from '@shared/deviceTypeDisplay'
import { showDeviceTypeCustomField, validateDeviceFormFieldValues } from '@shared/deviceSaveValidation'
import type { Device, DeviceGroup, SaveDevicePayload } from '@shared/types'

interface Props {
  device: Device | null
  groups: DeviceGroup[]
  /** When adding (device is null), seed fields — e.g. from a discovered ARP row. */
  prefill?: Partial<Pick<SaveDevicePayload, 'name' | 'ip' | 'subnet' | 'gateway'>> | null
  onClose: () => void
  onSave: (payload: SaveDevicePayload) => Promise<void>
}

export function DeviceForm({ device, groups, prefill, onClose, onSave }: Props): JSX.Element {
  const nameInputRef = useRef<HTMLInputElement>(null)
  const [name, setName] = useState('')
  const [ip, setIp] = useState('')
  const [subnet, setSubnet] = useState('')
  const [gateway, setGateway] = useState('')
  const [groupId, setGroupId] = useState('')
  const [deviceTypeCustom, setDeviceTypeCustom] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const showCustomTypeField = showDeviceTypeCustomField(device)

  const prefillSig = prefill
    ? `${prefill.name ?? ''}\u0000${prefill.ip ?? ''}\u0000${prefill.subnet ?? ''}\u0000${prefill.gateway ?? ''}`
    : ''

  useEffect(() => {
    if (device) {
      setName(device.name)
      setIp(device.ip)
      setSubnet(device.subnet)
      setGateway(device.gateway)
      setGroupId(device.groupId ?? '')
      setDeviceTypeCustom(device.deviceTypeCustom?.trim() ?? '')
    } else if (prefill) {
      setName(prefill.name ?? '')
      setIp(prefill.ip ?? '')
      setSubnet(prefill.subnet ?? '')
      setGateway(prefill.gateway ?? '')
      setGroupId('')
      setDeviceTypeCustom('')
    } else {
      setName('')
      setIp('')
      setSubnet('')
      setGateway('')
      setGroupId('')
      setDeviceTypeCustom('')
    }
    setError(null)
  }, [device?.id, device?.groupId, device?.deviceType, device?.deviceTypeCustom, prefillSig])

  /** Native window + explicit field focus so Add/Edit works after a post-delete keyboard routing bug. */
  useLayoutEffect(() => {
    reportTextEntrySurfaceOpened('DeviceForm')
    void prepareAppWindowForKeyboardInput('DeviceForm:open').then(() => {
      nameInputRef.current?.focus({ preventScroll: true })
    })
  }, [device?.id, prefillSig])

  async function submit(e: React.FormEvent): Promise<void> {
    e.preventDefault()
    setError(null)
    const v = validateDeviceFormFieldValues(
      { name, ip, subnet, gateway, deviceTypeCustom },
      showCustomTypeField
    )
    if (v) {
      setError(v)
      return
    }
    setSaving(true)
    try {
      const payload: SaveDevicePayload = {
        id: device?.id,
        name: name.trim(),
        ip: ip.trim(),
        subnet: subnet.trim(),
        gateway: gateway.trim(),
        groupId: groupId.trim() ? groupId.trim() : null
      }
      if (showCustomTypeField) {
        payload.deviceTypeCustom = deviceTypeCustom.trim() || null
      }
      await onSave(payload)
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div
      className="modal-backdrop"
      role="presentation"
      onClick={onClose}
      onMouseDown={(ev) => {
        if (ev.target === ev.currentTarget) ev.preventDefault()
      }}
    >
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        onClick={(ev) => ev.stopPropagation()}
        onMouseDown={(ev) => ev.stopPropagation()}
      >
        <h3>{device ? 'Edit device' : 'Add device'}</h3>
        <form onSubmit={(e) => void submit(e)}>
          <div className="form-row">
            <label htmlFor="name">Name</label>
            <input
              ref={nameInputRef}
              id="name"
              type="text"
              autoComplete="off"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <div className="form-row">
            <label htmlFor="ip">IP address</label>
            <input
              id="ip"
              type="text"
              autoComplete="off"
              value={ip}
              onChange={(e) => setIp(e.target.value)}
            />
          </div>
          <div className="form-row">
            <label htmlFor="subnet">Subnet mask</label>
            <input
              id="subnet"
              type="text"
              autoComplete="off"
              value={subnet}
              onChange={(e) => setSubnet(e.target.value)}
            />
          </div>
          <div className="form-row">
            <label htmlFor="gateway">Gateway</label>
            <input
              id="gateway"
              type="text"
              autoComplete="off"
              value={gateway}
              onChange={(e) => setGateway(e.target.value)}
            />
          </div>
          <div className="form-row">
            <label htmlFor="group">Group</label>
            <select
              id="group"
              value={groupId}
              onChange={(e) => setGroupId(e.target.value)}
            >
              <option value="">— None —</option>
              {groups.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.name}
                </option>
              ))}
            </select>
          </div>
          {showCustomTypeField ? (
            <div className="form-row">
              <label htmlFor="deviceTypeCustom">Custom type (optional)</label>
              <input
                id="deviceTypeCustom"
                type="text"
                autoComplete="off"
                maxLength={DEVICE_TYPE_CUSTOM_MAX_LEN}
                placeholder="e.g. NAS, security camera"
                value={deviceTypeCustom}
                onChange={(e) => setDeviceTypeCustom(e.target.value)}
              />
              <p className="muted u-muted-hint">
                Shown in the device list and map instead of the automatic type. Leave empty to use the inferred type
                only.
              </p>
            </div>
          ) : null}
          {error ? <p className="error">{error}</p> : null}
          <div className="form-actions">
            <button type="button" className="secondary" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" disabled={saving}>
              {saving ? 'Saving…' : 'Save'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
