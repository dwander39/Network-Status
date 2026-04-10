import type Database from 'better-sqlite3'
import { v4 as uuidv4 } from 'uuid'
import type { DeviceGroup, SaveDeviceGroupPayload } from '@shared/types'

function rowToGroup(row: Record<string, unknown>): DeviceGroup {
  return {
    id: String(row.id),
    name: String(row.name),
    sortOrder: Number(row.sort_order ?? 0)
  }
}

export function listDeviceGroups(db: Database.Database): DeviceGroup[] {
  const rows = db
    .prepare(
      `SELECT id, name, sort_order FROM device_groups ORDER BY sort_order ASC, name COLLATE NOCASE ASC`
    )
    .all() as Record<string, unknown>[]
  return rows.map(rowToGroup)
}

export function getDeviceGroupById(db: Database.Database, id: string): DeviceGroup | null {
  const row = db
    .prepare(`SELECT id, name, sort_order FROM device_groups WHERE id = ?`)
    .get(id) as Record<string, unknown> | undefined
  return row ? rowToGroup(row) : null
}

export function saveDeviceGroup(db: Database.Database, input: SaveDeviceGroupPayload): DeviceGroup {
  const name = input.name.trim()
  if (!name) throw new Error('Group name is required')

  if (input.id) {
    const existing = getDeviceGroupById(db, input.id)
    if (!existing) throw new Error('Group not found')
    const conflict = db
      .prepare(`SELECT id FROM device_groups WHERE name = ? COLLATE NOCASE AND id != ?`)
      .get(name, input.id) as { id: string } | undefined
    if (conflict) throw new Error('A group with this name already exists')
    db.prepare(`UPDATE device_groups SET name = ? WHERE id = ?`).run(name, input.id)
    return getDeviceGroupById(db, input.id)!
  }

  const conflict = db.prepare(`SELECT id FROM device_groups WHERE name = ? COLLATE NOCASE`).get(name)
  if (conflict) throw new Error('A group with this name already exists')

  const maxRow = db.prepare(`SELECT COALESCE(MAX(sort_order), -1) AS m FROM device_groups`).get() as {
    m: number
  }
  const sortOrder = maxRow.m + 1
  const id = uuidv4()
  db.prepare(
    `INSERT INTO device_groups (id, name, sort_order) VALUES (?, ?, ?)`
  ).run(id, name, sortOrder)
  return getDeviceGroupById(db, id)!
}

export function deleteDeviceGroup(db: Database.Database, id: string): boolean {
  const r = db.prepare(`DELETE FROM device_groups WHERE id = ?`).run(id)
  return r.changes > 0
}
