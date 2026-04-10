import type { AppSettings, EventSeverity, EventType } from '@shared/types'

const ORDER: EventType[] = [
  'DEVICE_ONLINE',
  'DEVICE_OFFLINE',
  'DEVICE_DISCOVERED',
  'MAC_ADDRESS_CHANGED',
  'NETWORK_CHANGED',
  'NETWORK_NEW_DETECTED',
  'ALERT_TRIGGERED',
  'SYSTEM_ERROR'
]

const LABELS: Record<EventType, string> = {
  DEVICE_ONLINE: 'Device online',
  DEVICE_OFFLINE: 'Device offline',
  DEVICE_DISCOVERED: 'New host discovered',
  MAC_ADDRESS_CHANGED: 'MAC address changed',
  NETWORK_CHANGED: 'Network changed',
  NETWORK_NEW_DETECTED: 'New network detected',
  ALERT_TRIGGERED: 'Alert triggered',
  SYSTEM_ERROR: 'System error'
}

interface Props {
  settings: AppSettings
}

export function EventLogSeveritySettingsPanel({ settings }: Props): JSX.Element {
  const api = window.ssApi

  function setOverride(eventType: EventType, raw: string): void {
    const next = { ...settings.eventLogSeverityOverrides }
    if (raw === '') {
      delete next[eventType]
    } else {
      next[eventType] = raw as EventSeverity
    }
    void api.saveSettings({ eventLogSeverityOverrides: next })
  }

  return (
    <div className="settings-section">
      <h3 className="settings-subheading settings-submenu__page-title">Event log severity</h3>
      <p className="muted">
        Override default severity per event type. Alert rules can set severity for their own{' '}
        <code>ALERT_TRIGGERED</code> rows (that takes precedence over the override below). Empty selection
        uses the built-in default mapping.
      </p>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Event</th>
              <th>Severity</th>
            </tr>
          </thead>
          <tbody>
            {ORDER.map((eventType) => {
              const current = settings.eventLogSeverityOverrides[eventType]
              const value = current ?? ''
              return (
                <tr key={eventType}>
                  <td>
                    <span title={eventType}>{LABELS[eventType]}</span>
                    <span className="u-muted-detail">
                      {eventType}
                    </span>
                  </td>
                  <td>
                    <select
                      value={value}
                      onChange={(e) => setOverride(eventType, e.target.value)}
                      aria-label={`Severity for ${eventType}`}
                    >
                      <option value="">Default (built-in)</option>
                      <option value="info">Info</option>
                      <option value="warning">Warning</option>
                      <option value="critical">Critical</option>
                    </select>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
