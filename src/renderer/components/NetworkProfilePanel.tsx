import { useEffect, useMemo, useState } from 'react'
import type { NetworkInfo, NetworkProfileListItem } from '@shared/types'

type Props = {
  networkInfo: NetworkInfo | null
  profiles: NetworkProfileListItem[]
  onProfilesUpdated: (list: NetworkProfileListItem[]) => void
  /** Fires when the saved-network dropdown selection changes (including initial default). */
  onViewingProfileChange?: (profile: NetworkProfileListItem | null) => void
}

/**
 * Saved LAN list + rename for the active profile. Selecting another profile is read-only (historical metadata).
 */
export function NetworkProfilePanel({
  networkInfo,
  profiles,
  onProfilesUpdated,
  onViewingProfileChange
}: Props): JSX.Element {
  const [selectedId, setSelectedId] = useState<string | null>(null)

  useEffect(() => {
    if (!selectedId && profiles.length > 0) {
      const def = profiles.find((p) => p.isActive)?.id ?? profiles[0].id
      setSelectedId(def)
    }
  }, [profiles, selectedId])

  const selected = useMemo(
    () => profiles.find((p) => p.id === selectedId) ?? null,
    [profiles, selectedId]
  )

  useEffect(() => {
    onViewingProfileChange?.(selected)
  }, [selected, onViewingProfileChange])

  return (
    <section className="network-profile-section" aria-label="Network profiles">
      <div className="section-header">
        <h2>Network profiles</h2>
      </div>
      <p className="muted">
        Each saved LAN gets a profile. Device and ARP data stay separate per network. Renaming applies to the
        network you are connected to now.
      </p>

      <div className="network-profile-grid">
        <label className="network-profile-field">
          Saved networks
          <select
            value={selectedId ?? ''}
            onChange={(e) => {
              const id = e.target.value || null
              setSelectedId(id)
            }}
          >
            {profiles.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
                {p.isActive ? ' (active)' : ''} — {p.deviceCount} devices
              </option>
            ))}
          </select>
        </label>

        {selected ? (
          <dl className="network-profile-details">
            <dt>Subnet (last seen)</dt>
            <dd>{selected.subnet || '—'}</dd>
            <dt>Gateway</dt>
            <dd>{selected.gateway || '—'}</dd>
            <dt>Last seen on this network</dt>
            <dd>{new Date(selected.lastSeen).toLocaleString()}</dd>
            <dt>First seen</dt>
            <dd>{new Date(selected.firstSeen).toLocaleString()}</dd>
            {!selected.isActive ? (
              <p className="muted network-profile-readonly">
                Read-only: connect to this LAN to monitor devices here. The table below is showing the selected
                saved network.
              </p>
            ) : null}
          </dl>
        ) : (
          <p className="muted">No saved profiles yet — connect to a network to create one.</p>
        )}
      </div>
    </section>
  )
}
