import { useEffect, useMemo, useState } from 'react'
import type { AppSettings, NetworkAdapter } from '@shared/types'

interface Props {
  settings: AppSettings
}

function adapterLabel(a: NetworkAdapter): string {
  const v4 = a.addresses.filter((x) => x.family === 'IPv4' && !x.internal).map((x) => x.address)
  if (v4.length) return `${a.name} (${v4.join(', ')})`
  return a.name
}

export function AdaptersPanel({ settings }: Props): JSX.Element {
  const api = window.ssApi
  const [adapters, setAdapters] = useState<NetworkAdapter[]>([])
  const [loadError, setLoadError] = useState<string | null>(null)

  useEffect(() => {
    void api
      .getNetworkAdapters()
      .then((a) => {
        setAdapters(a)
        setLoadError(null)
      })
      .catch((e: unknown) => {
        setLoadError(e instanceof Error ? e.message : 'Could not load adapters')
      })
  }, [api])

  const selected = useMemo(() => new Set(settings.listenAdapterNames), [settings.listenAdapterNames])

  async function toggle(name: string, checked: boolean): Promise<void> {
    const next = new Set(settings.listenAdapterNames)
    if (checked) next.add(name)
    else next.delete(name)
    const arr = Array.from(next)
    try {
      await api.saveSettings({ listenAdapterNames: arr })
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Could not save adapter selection')
    }
  }

  async function selectAll(): Promise<void> {
    const names = adapters.map((a) => a.name)
    await api.saveSettings({ listenAdapterNames: names })
  }

  async function selectNone(): Promise<void> {
    await api.saveSettings({ listenAdapterNames: [] })
  }

  return (
    <section className="section">
      <div className="section-header">
        <h2>Network adapters</h2>
        <div className="u-flex-row-wrap">
          <button type="button" className="secondary" onClick={() => void selectAll()}>
            Select all
          </button>
          <button type="button" className="secondary" onClick={() => void selectNone()}>
            Select none
          </button>
        </div>
      </div>
      <p className="muted">
        Choose which adapters the app should monitor on. If none are selected, ARP discovery and
        ping monitoring are disabled.
      </p>
      {loadError ? <p className="error">{loadError}</p> : null}
      {adapters.length === 0 ? (
        <p className="muted">No adapters found.</p>
      ) : (
        <div className="adapters-list">
          {adapters.map((a) => (
            <label key={a.name} className="adapters-item">
              <input
                type="checkbox"
                checked={selected.has(a.name)}
                onChange={(e) => void toggle(a.name, e.target.checked)}
              />
              {adapterLabel(a)}
            </label>
          ))}
        </div>
      )}
    </section>
  )
}

