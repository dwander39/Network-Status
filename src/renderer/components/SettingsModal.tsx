import { useState } from 'react'
import { useConfirmAction } from '../confirm/ConfirmDialogContext'
import { recoverKeyboardAfterDestructiveAction } from '../utils/postDeleteFocusRecovery'
import type { AppSettings, DeviceGroup } from '@shared/types'
import { AdaptersPanel } from './AdaptersPanel'
import { AlertRulesPanel } from './AlertRulesPanel'
import { GroupsPanel } from './GroupsPanel'
import { NetworkProfilesSettingsPanel } from './NetworkProfilesSettingsPanel'
import { EventLogSeveritySettingsPanel } from './EventLogSeveritySettingsPanel'

interface Props {
  settings: AppSettings
  groups: DeviceGroup[]
  onClose: () => void
}

type SettingsSection = 'general' | 'rules' | 'eventLog' | 'networks'

export function SettingsModal({ settings, groups, onClose }: Props): JSX.Element {
  const { confirmAction } = useConfirmAction()
  const api = window.ssApi
  const [section, setSection] = useState<SettingsSection>('general')
  const [purgeArpToo, setPurgeArpToo] = useState(false)

  async function purgeCurrentNetwork(): Promise<void> {
    const ok = await confirmAction({
      title: 'Clear devices for current network?',
      message:
        'Remove all monitored devices saved for the current network from the list. Device groups are not deleted.',
      confirmLabel: 'Clear devices',
      cancelLabel: 'Cancel',
      destructive: true
    })
    if (!ok) return
    try {
      const r = await api.purgeDeviceCache({ scope: 'current_network', includeArp: purgeArpToo })
      alert(
        `Removed ${r.devicesRemoved} device(s)` +
          (purgeArpToo ? ` and ${r.arpRemoved} ARP cache row(s).` : '.')
      )
      recoverKeyboardAfterDestructiveAction('settings:purgeCurrentNetwork')
    } catch (e) {
      alert(e instanceof Error ? e.message : String(e))
    }
  }

  async function purgeAllNetworks(): Promise<void> {
    const ok1 = await confirmAction({
      title: 'Clear all devices on every network?',
      message:
        'Delete every monitored device on all networks. This cannot be undone. Device groups are not removed.',
      confirmLabel: 'Continue',
      cancelLabel: 'Cancel',
      destructive: true
    })
    if (!ok1) return
    const ok2 = await confirmAction({
      title: 'Are you sure?',
      message: 'This permanently removes all saved devices from the database for every network.',
      confirmLabel: 'Yes, clear all',
      cancelLabel: 'Cancel',
      destructive: true
    })
    if (!ok2) return
    try {
      const r = await api.purgeDeviceCache({ scope: 'all', includeArp: purgeArpToo })
      alert(
        `Removed ${r.devicesRemoved} device(s)` +
          (purgeArpToo ? ` and ${r.arpRemoved} ARP row(s); dismissed-IP list cleared.` : '.')
      )
      recoverKeyboardAfterDestructiveAction('settings:purgeAllNetworks')
    } catch (e) {
      alert(e instanceof Error ? e.message : String(e))
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
        className="modal modal--wide"
        role="dialog"
        aria-modal="true"
        onClick={(ev) => ev.stopPropagation()}
        onMouseDown={(ev) => ev.stopPropagation()}
      >
        <div className="section-header u-section-header--modal">
          <h2 className="u-heading-reset">Settings</h2>
          <button type="button" className="secondary" onClick={onClose}>
            Close
          </button>
        </div>

        <nav className="settings-submenu" aria-label="Settings sections">
          <button
            type="button"
            className={section === 'general' ? 'settings-submenu__tab settings-submenu__tab--active' : 'settings-submenu__tab'}
            aria-current={section === 'general' ? 'page' : undefined}
            onClick={() => setSection('general')}
          >
            General
          </button>
          <button
            type="button"
            className={section === 'rules' ? 'settings-submenu__tab settings-submenu__tab--active' : 'settings-submenu__tab'}
            aria-current={section === 'rules' ? 'page' : undefined}
            onClick={() => setSection('rules')}
          >
            Rules
          </button>
          <button
            type="button"
            className={
              section === 'eventLog'
                ? 'settings-submenu__tab settings-submenu__tab--active'
                : 'settings-submenu__tab'
            }
            aria-current={section === 'eventLog' ? 'page' : undefined}
            onClick={() => setSection('eventLog')}
          >
            Event log
          </button>
          <button
            type="button"
            className={
              section === 'networks' ? 'settings-submenu__tab settings-submenu__tab--active' : 'settings-submenu__tab'
            }
            aria-current={section === 'networks' ? 'page' : undefined}
            onClick={() => setSection('networks')}
          >
            Networks
          </button>
        </nav>

        {section === 'general' ? (
          <GeneralSettingsContent
            settings={settings}
            purgeArpToo={purgeArpToo}
            setPurgeArpToo={setPurgeArpToo}
            purgeCurrentNetwork={purgeCurrentNetwork}
            purgeAllNetworks={purgeAllNetworks}
            groups={groups}
          />
        ) : section === 'rules' ? (
          <>
            <h3 className="settings-subheading settings-submenu__page-title">Rules</h3>
            <AlertRulesPanel showTitle={false} />
          </>
        ) : section === 'eventLog' ? (
          <EventLogSeveritySettingsPanel settings={settings} />
        ) : (
          <NetworkProfilesSettingsPanel />
        )}
      </div>
    </div>
  )
}

function GeneralSettingsContent({
  settings,
  purgeArpToo,
  setPurgeArpToo,
  purgeCurrentNetwork,
  purgeAllNetworks,
  groups
}: {
  settings: AppSettings
  purgeArpToo: boolean
  setPurgeArpToo: (v: boolean) => void
  purgeCurrentNetwork: () => Promise<void>
  purgeAllNetworks: () => Promise<void>
  groups: DeviceGroup[]
}): JSX.Element {
  const api = window.ssApi
  return (
    <>
      <div className="settings-section settings-section--data">
          <h3 className="settings-subheading">Device &amp; discovery cache</h3>
          <p className="muted">
            Remove saved devices from the list (SQLite). Optional: also clear ARP rows for the same scope.
            Legacy devices without a network tag are only removed by &quot;all networks&quot;.
          </p>
          <label className="u-label-inline u-label-inline--mb">
            <input
              type="checkbox"
              checked={purgeArpToo}
              onChange={(e) => setPurgeArpToo(e.target.checked)}
            />
            Also clear ARP cache for the same scope
          </label>
          <div className="settings-purge-actions">
            <button type="button" className="secondary" onClick={() => void purgeCurrentNetwork()}>
              Clear devices (current network)
            </button>
            <button type="button" className="danger" onClick={() => void purgeAllNetworks()}>
              Clear all devices (every network)
            </button>
          </div>
      </div>

      <div className="settings-grid">
          <label>
            Ping interval (seconds)
            <input
              type="number"
              min={1}
              value={Math.round(settings.pingIntervalMs / 1000)}
              onChange={(e) => {
                const sec = Number(e.target.value)
                if (!Number.isFinite(sec) || sec < 1) return
                void api.saveSettings({ pingIntervalMs: sec * 1000 })
              }}
            />
          </label>
          <label>
            ARP refresh (seconds)
            <input
              type="number"
              min={5}
              value={Math.round(settings.arpIntervalMs / 1000)}
              onChange={(e) => {
                const sec = Number(e.target.value)
                if (!Number.isFinite(sec) || sec < 5) return
                void api.saveSettings({ arpIntervalMs: sec * 1000 })
              }}
            />
          </label>
          <label className="u-label-inline">
            <input
              type="checkbox"
              checked={settings.notifyOnOffline}
              onChange={(e) => void api.saveSettings({ notifyOnOffline: e.target.checked })}
            />
            Notify on offline
          </label>
          <label className="u-label-inline">
            <input
              type="checkbox"
              checked={settings.notifyOnNewDevice}
              onChange={(e) => void api.saveSettings({ notifyOnNewDevice: e.target.checked })}
            />
            Notify on new ARP host
          </label>
          <label>
            ARP list
            <select
              value={settings.arpCacheMode}
              onChange={(e) =>
                void api.saveSettings({
                  arpCacheMode: e.target.value as 'mirror_os' | 'app_owned'
                })
              }
            >
              <option value="mirror_os">Mirror OS ARP table (drop when OS drops)</option>
              <option value="app_owned">App cache — merge + age out (TTL)</option>
            </select>
          </label>
          {settings.arpCacheMode === 'app_owned' ? (
            <>
              <label>
                ARP entry TTL (days)
                <input
                  type="number"
                  min={1}
                  max={365}
                  value={Math.round(settings.arpEntryTtlMs / (24 * 60 * 60 * 1000))}
                  onChange={(e) => {
                    const days = Number(e.target.value)
                    if (!Number.isFinite(days) || days < 1) return
                    void api.saveSettings({ arpEntryTtlMs: days * 24 * 60 * 60 * 1000 })
                  }}
                />
              </label>
              <label className="u-label-inline">
                <input
                  type="checkbox"
                  checked={settings.arpSubnetSweep}
                  onChange={(e) => void api.saveSettings({ arpSubnetSweep: e.target.checked })}
                />
                Ping-scan subnet before ARP refresh (uses each device’s netmask; slower)
              </label>
            </>
          ) : null}
      </div>

      <AdaptersPanel settings={settings} />
      <GroupsPanel groups={groups} />
    </>
  )
}

