import { useEffect, useMemo, useState } from 'react'
import type { ArpEntry } from '@shared/types'

export type DiscoveredSortKey = 'ip' | 'macAddress' | 'vendor' | 'network' | 'lastSeen'

/** Primary line for discovered-on column: profile name + CIDR, or fingerprint, or em dash. */
export function discoveredNetworkLabel(e: ArpEntry): string {
  if (e.networkProfileName?.trim()) {
    const sub = e.networkSubnetLabel?.trim()
    return sub ? `${e.networkProfileName.trim()} (${sub})` : e.networkProfileName.trim()
  }
  if (e.networkSubnetLabel?.trim()) return e.networkSubnetLabel.trim()
  if (e.networkId?.trim()) {
    const parts = e.networkId.split('|')
    return parts.length >= 2 ? parts[1] : e.networkId
  }
  return '—'
}

const COLLAPSE_KEY = 'system-status:discoveredCollapsed'

function sortDiscovered(
  list: ArpEntry[],
  key: DiscoveredSortKey,
  dir: 'asc' | 'desc'
): ArpEntry[] {
  const mul = dir === 'asc' ? 1 : -1
  const copy = [...list]
  copy.sort((a, b) => {
    if (key === 'ip') {
      return a.ip.localeCompare(b.ip, undefined, { numeric: true }) * mul
    }
    if (key === 'macAddress') {
      return a.macAddress.localeCompare(b.macAddress) * mul
    }
    if (key === 'vendor') {
      const va = (a.vendor ?? '').toLowerCase()
      const vb = (b.vendor ?? '').toLowerCase()
      if (va !== vb) return va.localeCompare(vb) * mul
      return a.ip.localeCompare(b.ip, undefined, { numeric: true }) * mul
    }
    if (key === 'network') {
      const na = discoveredNetworkLabel(a).toLowerCase()
      const nb = discoveredNetworkLabel(b).toLowerCase()
      if (na !== nb) return na.localeCompare(nb) * mul
      return a.ip.localeCompare(b.ip, undefined, { numeric: true }) * mul
    }
    const ta = new Date(a.lastSeen).getTime()
    const tb = new Date(b.lastSeen).getTime()
    return (ta - tb) * mul
  })
  return copy
}

interface Props {
  entries: ArpEntry[]
  /** IPs already saved — disables “Add to list” for those rows. */
  savedIps: ReadonlySet<string>
  onRefresh: () => Promise<void>
  onAddToList: (entry: ArpEntry) => void
  /** Hide a row when the OS still has a stale ARP entry after disconnect. */
  onDismiss: (entry: ArpEntry) => Promise<void>
  /** Clear all hidden IPs so they can appear again after reconnect. */
  onClearDismissed: () => Promise<void>
}

export function DiscoveredPanel({
  entries,
  savedIps,
  onRefresh,
  onAddToList,
  onDismiss,
  onClearDismissed
}: Props): JSX.Element {
  const [busy, setBusy] = useState(false)
  const [sortKey, setSortKey] = useState<DiscoveredSortKey>('lastSeen')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc')
  const [collapsed, setCollapsed] = useState(false)

  const sortedEntries = useMemo(
    () => sortDiscovered(entries, sortKey, sortDir),
    [entries, sortKey, sortDir]
  )

  function toggleSort(k: DiscoveredSortKey): void {
    if (sortKey === k) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
    else {
      setSortKey(k)
      setSortDir('asc')
    }
  }

  const label = (k: DiscoveredSortKey, text: string): string =>
    sortKey === k ? `${text} ${sortDir === 'asc' ? '▲' : '▼'}` : text

  useEffect(() => {
    try {
      setCollapsed(localStorage.getItem(COLLAPSE_KEY) === '1')
    } catch {
      // ignore
    }
  }, [])

  function toggleCollapsed(): void {
    setCollapsed((c) => {
      const next = !c
      try {
        localStorage.setItem(COLLAPSE_KEY, next ? '1' : '0')
      } catch {
        // ignore
      }
      return next
    })
  }

  async function handleRefresh(): Promise<void> {
    if (busy) return
    setBusy(true)
    try {
      await onRefresh()
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="section">
      <div className="section-header">
        <h2>Discovered devices</h2>
        <div className="u-flex-row-wrap">
          <button
            type="button"
            className="secondary"
            aria-expanded={!collapsed}
            onClick={toggleCollapsed}
          >
            {collapsed ? 'Expand' : 'Collapse'}
          </button>
          <button
            type="button"
            className="secondary"
            disabled={busy}
            onClick={() => void handleRefresh()}
          >
            {busy ? 'Refreshing…' : 'Refresh now'}
          </button>
          <button type="button" className="secondary" onClick={() => void onClearDismissed()}>
            Show hidden hosts again
          </button>
        </div>
      </div>
      {!collapsed ? (
        <>
          <p className="muted">
            This list mirrors your PC&apos;s ARP cache. After a device disconnects, Windows/macOS
            often keeps its IP for minutes — refresh alone may not remove it. Use{' '}
            <strong>Hide</strong> to drop ghost entries; use <strong>Show hidden hosts again</strong>{' '}
            to reset that. New IPs only appear after this PC talks to that address (e.g. ping).
          </p>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th onClick={() => toggleSort('ip')}>{label('ip', 'IP')}</th>
                  <th onClick={() => toggleSort('macAddress')}>{label('macAddress', 'MAC')}</th>
                  <th onClick={() => toggleSort('vendor')}>{label('vendor', 'Vendor')}</th>
                  <th onClick={() => toggleSort('network')}>{label('network', 'Discovered on')}</th>
                  <th onClick={() => toggleSort('lastSeen')}>{label('lastSeen', 'Last seen')}</th>
                  <th className="th-actions" />
                </tr>
              </thead>
              <tbody>
                {busy ? (
                  <tr>
                    <td colSpan={6} className="muted">
                      Scanning ARP cache…
                    </td>
                  </tr>
                ) : entries.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="muted">
                      No unknown ARP entries yet.
                    </td>
                  </tr>
                ) : (
                  sortedEntries.map((e) => {
                    const already = savedIps.has(e.ip)
                    return (
                      <tr key={e.id}>
                        <td>{e.ip}</td>
                        <td>{e.macAddress}</td>
                        <td className="muted">{e.vendor ?? '—'}</td>
                        <td className="muted" title={e.networkId ?? undefined}>
                          {discoveredNetworkLabel(e)}
                        </td>
                        <td className="muted">{new Date(e.lastSeen).toLocaleString()}</td>
                        <td>
                          <div className="u-flex-end-gap-sm">
                            <button
                              type="button"
                              className="secondary u-nowrap"
                              disabled={already}
                              title={
                                already
                                  ? 'This IP is already in your device list'
                                  : 'Add to monitored devices'
                              }
                              onClick={() => onAddToList(e)}
                            >
                              {already ? 'Saved' : 'Add to list'}
                            </button>
                            <button
                              type="button"
                              className="secondary u-nowrap"
                              title="Hide this row (OS ARP can keep stale entries after disconnect)"
                              onClick={() => void onDismiss(e)}
                            >
                              Hide
                            </button>
                          </div>
                        </td>
                      </tr>
                    )
                  })
                )}
              </tbody>
            </table>
          </div>
        </>
      ) : null}
    </section>
  )
}
