import { useLayoutEffect, useRef, useState } from 'react'
import { prepareAppWindowForKeyboardInput } from '../utils/ensureTextFieldFocus'
import { reportTextEntrySurfaceOpened } from '../utils/postDeleteFocusRecovery'
import type { NewNetworkDetectedPayload } from '@shared/types'

type Props = {
  payload: NewNetworkDetectedPayload
  onClose: () => void
  onSave: (name: string) => Promise<void>
  onIgnore: () => Promise<void>
}

export function NewNetworkDetectedModal({ payload, onClose, onSave, onIgnore }: Props): JSX.Element {
  const nameInputRef = useRef<HTMLInputElement>(null)
  const [name, setName] = useState(payload.suggestedName)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSave(): Promise<void> {
    if (busy) return
    const trimmed = name.trim()
    if (!trimmed) {
      setError('Name is required')
      return
    }
    setError(null)
    setBusy(true)
    try {
      await onSave(trimmed)
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  async function handleIgnore(): Promise<void> {
    if (busy) return
    setError(null)
    setBusy(true)
    try {
      await onIgnore()
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  useLayoutEffect(() => {
    reportTextEntrySurfaceOpened('NewNetworkDetectedModal')
    void prepareAppWindowForKeyboardInput('NewNetworkDetectedModal:open').then(() => {
      nameInputRef.current?.focus({ preventScroll: true })
    })
  }, [payload.gateway, payload.subnet, payload.ssid, payload.suggestedName])

  return (
    <div className="modal-backdrop" role="presentation" onClick={onClose}>
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        onClick={(ev) => ev.stopPropagation()}
        onMouseDown={(ev) => ev.stopPropagation()}
      >
        <div className="section-header u-section-header--modal">
          <h2 className="u-heading-reset">New network detected</h2>
          <button type="button" className="secondary" onClick={onClose} disabled={busy}>
            Close
          </button>
        </div>

        <p className="muted u-mt-0">
          {payload.ssid ? (
            <>
              Wi‑Fi <strong>{payload.ssid}</strong>
            </>
          ) : (
            <>This network doesn’t report a Wi‑Fi SSID.</>
          )}
          <br />
          <span className="muted">
            Gateway {payload.gateway} — Subnet {payload.subnet}
          </span>
        </p>

        <label>
          Save as
          <input
            ref={nameInputRef}
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Home, Office"
            disabled={busy}
          />
        </label>

        {error ? <p className="error">{error}</p> : null}

        <div className="u-flex-end-gap-mt">
          <button type="button" className="secondary" disabled={busy} onClick={() => void handleIgnore()}>
            {busy ? 'Working…' : 'Ignore'}
          </button>
          <button type="button" disabled={busy} onClick={() => void handleSave()}>
            {busy ? 'Saving…' : 'Save network'}
          </button>
        </div>
      </div>
    </div>
  )
}

