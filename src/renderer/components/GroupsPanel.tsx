import { useState } from 'react'
import { useConfirmAction } from '../confirm/ConfirmDialogContext'
import {
  logDeleteFlowPreDelete,
  recoverKeyboardAfterDestructiveAction
} from '../utils/postDeleteFocusRecovery'
import type { DeviceGroup } from '@shared/types'

interface Props {
  groups: DeviceGroup[]
}

export function GroupsPanel({ groups }: Props): JSX.Element {
  const { confirmAction } = useConfirmAction()
  const api = window.ssApi
  const [newName, setNewName] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editName, setEditName] = useState('')
  const [busy, setBusy] = useState(false)

  async function add(): Promise<void> {
    const name = newName.trim()
    if (!name || busy) return
    setBusy(true)
    try {
      await api.saveDeviceGroup({ name })
      setNewName('')
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Could not add group')
    } finally {
      setBusy(false)
    }
  }

  async function saveRename(id: string): Promise<void> {
    const name = editName.trim()
    if (!name || busy) return
    setBusy(true)
    try {
      await api.saveDeviceGroup({ id, name })
      setEditingId(null)
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Could not rename group')
    } finally {
      setBusy(false)
    }
  }

  async function remove(id: string): Promise<void> {
    const ok = await confirmAction({
      title: 'Delete device group?',
      message: 'Devices in this group will become ungrouped.',
      confirmLabel: 'Delete',
      cancelLabel: 'Cancel',
      destructive: true
    })
    if (!ok) return
    setBusy(true)
    try {
      logDeleteFlowPreDelete('settings:deleteDeviceGroup')
      await api.deleteDeviceGroup(id)
      recoverKeyboardAfterDestructiveAction('settings:deleteDeviceGroup')
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Could not delete group')
    } finally {
      setBusy(false)
    }
  }

  function startEdit(g: DeviceGroup): void {
    setEditingId(g.id)
    setEditName(g.name)
  }

  return (
    <section className="section">
      <div className="section-header">
        <h2>Device groups</h2>
      </div>
      <p className="muted">
        Create groups here, then assign each device from the table dropdown or from Add/Edit device.
      </p>
      <div className="groups-toolbar">
        <input
          type="text"
          autoComplete="off"
          placeholder="New group name"
          value={newName}
          disabled={busy}
          onChange={(e) => setNewName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void add()
          }}
        />
        <button type="button" disabled={busy || !newName.trim()} onClick={() => void add()}>
          Add group
        </button>
      </div>
      {groups.length === 0 ? (
        <p className="muted">No groups yet.</p>
      ) : (
        <ul className="groups-list">
          {groups.map((g) => (
            <li key={g.id}>
              {editingId === g.id ? (
                <>
                  <input
                    type="text"
                    autoComplete="off"
                    value={editName}
                    disabled={busy}
                    onChange={(e) => setEditName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') void saveRename(g.id)
                      if (e.key === 'Escape') setEditingId(null)
                    }}
                    autoFocus
                  />
                  <button
                    type="button"
                    className="secondary"
                    disabled={busy}
                    onClick={() => void saveRename(g.id)}
                  >
                    Save
                  </button>
                  <button
                    type="button"
                    className="secondary"
                    disabled={busy}
                    onClick={() => setEditingId(null)}
                  >
                    Cancel
                  </button>
                </>
              ) : (
                <>
                  <span className="groups-list-name">{g.name}</span>
                  <button
                    type="button"
                    className="secondary"
                    disabled={busy}
                    onClick={() => startEdit(g)}
                  >
                    Rename
                  </button>
                  <button
                    type="button"
                    className="danger"
                    disabled={busy}
                    onClick={() => void remove(g.id)}
                  >
                    Delete
                  </button>
                </>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
