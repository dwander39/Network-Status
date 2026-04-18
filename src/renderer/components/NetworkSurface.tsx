import type { ComponentProps } from 'react'
import { DiscoveredPanel } from './DiscoveredPanel'
import { EventLogPanel } from './EventLogPanel'

type NetworkSurfaceProps = ComponentProps<typeof DiscoveredPanel> & ComponentProps<typeof EventLogPanel>

/**
 * Network surface shell; discovered devices and other network-scoped UI land here.
 */
export function NetworkSurface({
  entries,
  savedIps,
  onRefresh,
  onAddToList,
  onDismiss,
  onClearDismissed,
  activeNetworkId,
  profiles
}: NetworkSurfaceProps): JSX.Element {
  return (
    <section className="section network-surface-section" aria-label="Network">
      <div className="section-header">
        <h2>Network</h2>
      </div>
      <DiscoveredPanel
        entries={entries}
        savedIps={savedIps}
        onRefresh={onRefresh}
        onAddToList={onAddToList}
        onDismiss={onDismiss}
        onClearDismissed={onClearDismissed}
      />
      <EventLogPanel activeNetworkId={activeNetworkId} profiles={profiles} />
    </section>
  )
}
