import { useEffect, useMemo, useState } from 'react'
import { useConfirmAction } from '../confirm/ConfirmDialogContext'
import {
  logDeleteFlowPreDelete,
  recoverKeyboardAfterDestructiveAction
} from '../utils/postDeleteFocusRecovery'
import type { NetworkProfileListItem } from '@shared/types'

export function NetworkProfilesSettingsPanel(): JSX.Element {
  const { confirmAction } = useConfirmAction()
  const api = window.ssApi
  const [profiles, setProfiles] = useState<NetworkProfileListItem[]>([])
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const [busyId, setBusyId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function reload(): Promise<void> {
    const list = await api.getNetworkProfiles()
    setProfiles(list)
    setDrafts((prev) => {
      // Preserve unsaved drafts when possible; otherwise seed from current names.
      const next: Record<string, string> = {}
      for (const p of list) next[p.id] = prev[p.id] ?? p.name
      return next
    })
  }

  useEffect(() => {
    void reload().catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const byLastSeen = useMemo(() => profiles, [profiles])

  async function saveRename(p: NetworkProfileListItem): Promise<void> {
    if (busyId) return
    const name = (drafts[p.id] ?? '').trim()
    if (!name) {
      setError('Name is required')
      return
    }
    setError(null)
    setBusyId(p.id)
    try {
      await api.renameNetworkProfile({ id: p.isActive ? p.id : p.id, name })
      await reload()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusyId(null)
    }
  }

  async function deleteProfile(p: NetworkProfileListItem): Promise<void> {
    if (busyId) return
    if (p.isActive) {
      alert('Cannot delete the active network. Connect to a different network first.')
      return
    }
    const ok = await confirmAction({
      title: `Delete saved network “${p.name}”?`,
      message: 'This will remove this saved profile and its scoped data.',
      detail: 'Monitored devices, ARP history, and map layout for this network will be deleted.',
      confirmLabel: 'Delete network',
      cancelLabel: 'Cancel',
      destructive: true
    })
    if (!ok) return
    setError(null)
    setBusyId(p.id)
    try {
      logDeleteFlowPreDelete('settings:deleteNetworkProfile')
      await api.deleteNetworkProfile(p.id)
      await reload()
      recoverKeyboardAfterDestructiveAction('settings:deleteNetworkProfile')
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusyId(null)
    }
  }

  return (
    <div className="settings-section">
      <h3 className="settings-subheading settings-submenu__page-title">Saved networks</h3>
      <p className="muted">
        Rename saved networks for clarity. Deleting a saved network removes its scoped data (devices, ARP history,
        and map layout).
      </p>

      {error ? <p className="error">{error}</p> : null}

      {byLastSeen.length === 0 ? (
        <p className="muted">No saved networks yet — connect to a network to create one.</p>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>SSID</th>
                <th>Subnet</th>
                <th>Gateway</th>
                <th>Devices</th>
                <th>Last seen</th>
                <th className="th-actions" />
              </tr>
            </thead>
            <tbody>
              {byLastSeen.map((p) => {
                const busy = busyId === p.id
                return (
                  <tr key={p.id}>
                    <td className="u-minw-220">
                      <input
                        type="text"
                        value={drafts[p.id] ?? p.name}
                        onChange={(e) =>
                          setDrafts((d) => ({
                            ...d,
                            [p.id]: e.target.value
                          }))
                        }
                        disabled={busy}
                      />
                      {p.isActive ? <div className="muted">Active</div> : null}
                    </td>
                    <td className="muted">{p.ssid ?? '—'}</td>
                    <td className="muted">{p.subnet || '—'}</td>
                    <td className="muted">{p.gateway || '—'}</td>
                    <td className="muted">{p.deviceCount}</td>
                    <td className="muted">{new Date(p.lastSeen).toLocaleString()}</td>
                    <td>
                      <div className="u-flex-end-gap-sm">
                        <button
                          type="button"
                          className="secondary"
                          disabled={busy}
                          onClick={() => void saveRename(p)}
                        >
                          {busy ? 'Saving…' : 'Save'}
                        </button>
                        <button
                          type="button"
                          className="danger"
                          disabled={busy || p.isActive}
                          title={p.isActive ? 'Cannot delete the active network' : 'Delete saved network'}
                          onClick={() => void deleteProfile(p)}
                        >
                          Delete
                        </button>
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

