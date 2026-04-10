import type Database from 'better-sqlite3'
import { v4 as uuidv4 } from 'uuid'
import type {
  AlertRule,
  AlertRuleConditionConfig,
  AlertConditionType,
  EventSeverity,
  SaveAlertRulePayload
} from '@shared/types'
import { normalizeNetworkId } from '../services/networkDetection'

function parseEventLogSeverity(raw: unknown): EventSeverity | null {
  if (raw == null || raw === '') return null
  const s = String(raw)
  if (s === 'info' || s === 'warning' || s === 'critical') return s
  return null
}

function parseConfig(json: string): AlertRuleConditionConfig {
  try {
    const o = JSON.parse(json) as unknown
    if (o && typeof o === 'object' && !Array.isArray(o)) return o as AlertRuleConditionConfig
  } catch {
    /* ignore */
  }
  return {}
}

function rowToRule(row: Record<string, unknown>): AlertRule {
  return {
    id: String(row.id),
    name: String(row.name),
    enabled: Number(row.enabled) === 1,
    networkId:
      row.network_id != null && String(row.network_id).trim() !== ''
        ? String(row.network_id)
        : null,
    conditionType: String(row.condition_type) as AlertConditionType,
    conditionConfig: parseConfig(String(row.condition_config_json ?? '{}')),
    lastTriggered: row.last_triggered != null ? String(row.last_triggered) : null,
    cooldownSeconds: Math.max(0, Number(row.cooldown_seconds) || 0),
    eventLogSeverity: parseEventLogSeverity(row.event_log_severity)
  }
}

export function listAlertRules(db: Database.Database): AlertRule[] {
  const rows = db
    .prepare(
      `SELECT id, name, enabled, network_id, condition_type, condition_config_json, last_triggered, cooldown_seconds
       FROM alert_rules ORDER BY name COLLATE NOCASE`
    )
    .all() as Record<string, unknown>[]
  return rows.map(rowToRule)
}

/** Enabled rules that apply to the current LAN (global + matching network_id). */
export function listEnabledAlertRulesForContext(
  db: Database.Database,
  contextNetworkId: string | null
): AlertRule[] {
  const rows = db
    .prepare(
      `SELECT id, name, enabled, network_id, condition_type, condition_config_json, last_triggered, cooldown_seconds, event_log_severity
       FROM alert_rules WHERE enabled = 1`
    )
    .all() as Record<string, unknown>[]
  return rows
    .map(rowToRule)
    .filter((r) => ruleMatchesNetworkContext(r, contextNetworkId))
}

function ruleMatchesNetworkContext(rule: AlertRule, contextNetworkId: string | null): boolean {
  if (rule.networkId == null || rule.networkId === '') return true
  if (contextNetworkId == null || contextNetworkId === '') return false
  return rule.networkId === contextNetworkId
}

export function getAlertRule(db: Database.Database, id: string): AlertRule | null {
  const row = db
    .prepare(
      `SELECT id, name, enabled, network_id, condition_type, condition_config_json, last_triggered, cooldown_seconds, event_log_severity
       FROM alert_rules WHERE id = ?`
    )
    .get(id) as Record<string, unknown> | undefined
  return row ? rowToRule(row) : null
}

export function saveAlertRule(db: Database.Database, input: SaveAlertRulePayload): AlertRule {
  const id = input.id ?? uuidv4()
  const name = input.name.trim()
  if (!name) throw new Error('Rule name is required')
  const nid =
    input.networkId != null && String(input.networkId).trim() !== ''
      ? normalizeNetworkId(String(input.networkId))
      : null
  const cfgJson = JSON.stringify(input.conditionConfig ?? {})
  const cd = Math.max(0, Math.floor(Number(input.cooldownSeconds) || 0))
  const els =
    input.eventLogSeverity != null ? input.eventLogSeverity : null

  const existing = db.prepare(`SELECT id FROM alert_rules WHERE id = ?`).get(id)
  if (existing) {
    db.prepare(
      `UPDATE alert_rules SET name = ?, enabled = ?, network_id = ?, condition_type = ?, condition_config_json = ?, cooldown_seconds = ?, event_log_severity = ?
       WHERE id = ?`
    ).run(
      name,
      input.enabled ? 1 : 0,
      nid,
      input.conditionType,
      cfgJson,
      cd,
      els,
      id
    )
  } else {
    db.prepare(
      `INSERT INTO alert_rules (id, name, enabled, network_id, condition_type, condition_config_json, last_triggered, cooldown_seconds, event_log_severity)
       VALUES (?, ?, ?, ?, ?, ?, NULL, ?, ?)`
    ).run(id, name, input.enabled ? 1 : 0, nid, input.conditionType, cfgJson, cd, els)
  }
  return getAlertRule(db, id)!
}

export function deleteAlertRule(db: Database.Database, id: string): boolean {
  return db.prepare(`DELETE FROM alert_rules WHERE id = ?`).run(id).changes > 0
}

/** Persist cooldown anchor after a notification is shown. */
export function updateAlertRuleLastTriggered(
  db: Database.Database,
  id: string,
  iso: string
): void {
  db.prepare(`UPDATE alert_rules SET last_triggered = ? WHERE id = ?`).run(iso, id)
}
