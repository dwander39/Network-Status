/**
 * Event Log fallback network scope used when a true `networkId` isn't available yet.
 *
 * Guardrails:
 * - This is **not** a real network id and must never be used for profiles, layouts, or settings.
 * - It exists only so events like ALERT_TRIGGERED can be logged explicitly even when network context is unavailable.
 */
export const EVENT_LOG_NETWORK_UNKNOWN = 'network_unknown' as const

