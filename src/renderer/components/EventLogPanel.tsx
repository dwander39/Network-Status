import { useEffect, useMemo, useState } from 'react'
import { useConfirmAction } from '../confirm/ConfirmDialogContext'
import {
  logDeleteFlowPreDelete,
  recoverKeyboardAfterDestructiveAction
} from '../utils/postDeleteFocusRecovery'
import type { EventLog, EventSeverity, EventType, NetworkProfileListItem } from '@shared/types'
import { EVENT_LOG_NETWORK_UNKNOWN } from '@shared/eventLog'

const COLLAPSE_KEY = 'system-status:eventLogCollapsed'

type Props = {
  activeNetworkId: string | null
  profiles: NetworkProfileListItem[]
}

const EVENT_TYPES: EventType[] = [
  'DEVICE_ONLINE',
  'DEVICE_OFFLINE',
  'DEVICE_DISCOVERED',
  'MAC_ADDRESS_CHANGED',
  'NETWORK_CHANGED',
  'NETWORK_NEW_DETECTED',
  'ALERT_TRIGGERED',
  'SYSTEM_ERROR'
]

export function EventLogPanel({ activeNetworkId, profiles }: Props): JSX.Element {
  const { confirmAction } = useConfirmAction()
  const api = window.ssApi
  const [collapsed, setCollapsed] = useState(false)
  const [events, setEvents] = useState<EventLog[]>([])
  const [filterType, setFilterType] = useState<EventType | ''>('')
  const [filterSeverity, setFilterSeverity] = useState<EventSeverity | ''>('')
  const [filterNetwork, setFilterNetwork] = useState<string>('active')
  const [busy, setBusy] = useState(false)

  const activeProfileName = useMemo(() => {
    const p = profiles.find((x) => x.isActive)
    return p?.name ?? null
  }, [profiles])

  const selectedNetworkId =
    filterNetwork === 'active'
      ? activeNetworkId
      : filterNetwork === 'all'
        ? null
        : filterNetwork

  async function reload(): Promise<void> {
    const list = await api.getEventLogs({
      networkId: selectedNetworkId,
      eventType: filterType || null,
      severity: filterSeverity || null,
      limit: 500
    })
    setEvents(list)
  }

  const currentQuery = useMemo(
    () => ({
      networkId: selectedNetworkId,
      eventType: filterType || null,
      severity: filterSeverity || null
    }),
    [selectedNetworkId, filterType, filterSeverity]
  )

  async function clearLogs(scope: 'all' | 'filtered'): Promise<void> {
    if (busy) return
    const ok = await confirmAction({
      title: 'Clear event logs?',
      message:
        scope === 'all'
          ? 'Remove all event log rows. This cannot be undone.'
          : 'Remove event log rows matching the current filters. This cannot be undone.',
      confirmLabel: 'Clear',
      cancelLabel: 'Cancel',
      destructive: true
    })
    if (!ok) return
    setBusy(true)
    try {
      logDeleteFlowPreDelete('eventLog:clearLogs')
      await api.clearEventLogs({ query: scope === 'all' ? {} : currentQuery })
      await reload()
      recoverKeyboardAfterDestructiveAction('eventLog:clearLogs')
    } catch (e) {
      alert(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  async function exportLogs(scope: 'all' | 'filtered', format: 'csv' | 'json'): Promise<void> {
    if (busy) return
    setBusy(true)
    try {
      const r = await api.exportEventLogs({
        format,
        query: scope === 'all' ? {} : currentQuery
      })
      if (r.savedPath) alert(`Exported ${r.rowsExported} row(s) to:\n${r.savedPath}`)
    } catch (e) {
      alert(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  useEffect(() => {
    try {
      setCollapsed(localStorage.getItem(COLLAPSE_KEY) === '1')
    } catch {
      /* ignore */
    }
  }, [])

  useEffect(() => {
    void reload().catch(() => {
      /* ignore */
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filterType, filterSeverity, filterNetwork, activeNetworkId])

  useEffect(() => {
    const unsub = api.onEventLogAdded((ev) => {
      // Keep it simple: show newest first. If filters exclude it, ignore.
      if (selectedNetworkId && ev.networkId !== selectedNetworkId) return
      if (filterType && ev.eventType !== filterType) return
      if (filterSeverity && ev.severity !== filterSeverity) return
      setEvents((prev) => [ev, ...prev].slice(0, 500))
    })
    return () => unsub()
  }, [api, filterType, filterSeverity, selectedNetworkId])

  function toggleCollapsed(): void {
    setCollapsed((c) => {
      const next = !c
      try {
        localStorage.setItem(COLLAPSE_KEY, next ? '1' : '0')
      } catch {
        /* ignore */
      }
      return next
    })
  }

  return (
    <section className="section">
      <div className="section-header">
        <h2>Event log</h2>
        <div className="u-flex-row-wrap">
          <button type="button" className="secondary" aria-expanded={!collapsed} onClick={toggleCollapsed}>
            {collapsed ? 'Expand' : 'Collapse'}
          </button>
          <button type="button" className="secondary" disabled={busy} onClick={() => void reload()}>
            Refresh
          </button>
          <button type="button" className="secondary" disabled={busy} onClick={() => void exportLogs('filtered', 'csv')}>
            Export CSV
          </button>
          <button type="button" className="secondary" disabled={busy} onClick={() => void exportLogs('filtered', 'json')}>
            Export JSON
          </button>
          <button type="button" className="danger" disabled={busy} onClick={() => void clearLogs('filtered')}>
            Clear
          </button>
        </div>
      </div>

      {!collapsed ? (
        <>
          <div className="toolbar u-toolbar-tight">
            <label>
              Network
              <select value={filterNetwork} onChange={(e) => setFilterNetwork(e.target.value)}>
                <option value="active">Active{activeProfileName ? ` (${activeProfileName})` : ''}</option>
                <option value="all">All networks</option>
                <option value={EVENT_LOG_NETWORK_UNKNOWN}>Unknown Network</option>
                {profiles.map((p) => (
                  <option key={p.id} value={p.networkId}>
                    {p.name}
                    {p.isActive ? ' (active)' : ''}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Type
              <select value={filterType} onChange={(e) => setFilterType(e.target.value as EventType | '')}>
                <option value="">All</option>
                {EVENT_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Severity
              <select
                value={filterSeverity}
                onChange={(e) => setFilterSeverity(e.target.value as EventSeverity | '')}
              >
                <option value="">All</option>
                <option value="info">info</option>
                <option value="warning">warning</option>
                <option value="critical">critical</option>
              </select>
            </label>
            <div className="u-ml-auto-flex">
              <button type="button" className="secondary" disabled={busy} onClick={() => void exportLogs('all', 'csv')}>
                Export all (CSV)
              </button>
              <button type="button" className="secondary" disabled={busy} onClick={() => void exportLogs('all', 'json')}>
                Export all (JSON)
              </button>
              <button type="button" className="danger" disabled={busy} onClick={() => void clearLogs('all')}>
                Clear all
              </button>
            </div>
          </div>

          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Time</th>
                  <th>Severity</th>
                  <th>Type</th>
                  <th>Message</th>
                  <th className="th-actions">IP</th>
                </tr>
              </thead>
              <tbody>
                {events.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="muted">
                      No events yet.
                    </td>
                  </tr>
                ) : (
                  events.map((e) => (
                    <tr key={e.id}>
                      <td className="muted">{new Date(e.timestamp).toLocaleString()}</td>
                      <td className="muted">{e.severity}</td>
                      <td className="muted">{e.eventType}</td>
                      <td>{e.message}</td>
                      <td className="muted">{e.ipAddress ?? '—'}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </>
      ) : null}
    </section>
  )
}

