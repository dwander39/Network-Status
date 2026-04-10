import type Database from 'better-sqlite3'
import { v4 as uuidv4 } from 'uuid'
import type {
  CreateMapManualGroupPayload,
  MapLayoutBundle,
  MapLayoutPositionInput,
  MapLayoutSnapshot,
  MapManualGroup,
  MapManualGroupLayoutInput,
  RenameMapManualGroupPayload
} from '@shared/types'

/** DB / React Flow id for the synthetic gateway node (not a devices row). */
export const MAP_LAYOUT_GATEWAY_KEY = '__gateway__'

function rowToGroup(row: Record<string, unknown>): MapManualGroup {
  return {
    id: String(row.id),
    networkId: String(row.network_id),
    name: String(row.name),
    x: Number(row.pos_x),
    y: Number(row.pos_y),
    width: Number(row.width),
    height: Number(row.height),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at)
  }
}

/** User-defined map regions for the canvas; scoped by `network_id` (never mixed across LANs). */
export function listManualGroupsForNetwork(db: Database.Database, networkId: string): MapManualGroup[] {
  const rows = db
    .prepare(
      `SELECT id, network_id, name, pos_x, pos_y, width, height, created_at, updated_at
       FROM map_manual_groups WHERE network_id = @nid ORDER BY name COLLATE NOCASE`
    )
    .all({ nid: networkId }) as Record<string, unknown>[]
  return rows.map(rowToGroup)
}

export function getManualGroup(db: Database.Database, id: string): MapManualGroup | null {
  const row = db
    .prepare(
      `SELECT id, network_id, name, pos_x, pos_y, width, height, created_at, updated_at
       FROM map_manual_groups WHERE id = ?`
    )
    .get(id) as Record<string, unknown> | undefined
  return row ? rowToGroup(row) : null
}

export function createManualGroup(
  db: Database.Database,
  payload: CreateMapManualGroupPayload
): MapManualGroup {
  const id = uuidv4()
  const iso = new Date().toISOString()
  db.prepare(
    `INSERT INTO map_manual_groups (id, network_id, name, pos_x, pos_y, width, height, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    payload.networkId,
    payload.name.trim() || 'Group',
    payload.x,
    payload.y,
    payload.width,
    payload.height,
    iso,
    iso
  )
  return getManualGroup(db, id)!
}

export function renameManualGroup(db: Database.Database, payload: RenameMapManualGroupPayload): boolean {
  const iso = new Date().toISOString()
  const name = payload.name.trim() || 'Group'
  const r = db
    .prepare(`UPDATE map_manual_groups SET name = ?, updated_at = ? WHERE id = ?`)
    .run(name, iso, payload.id)
  return r.changes > 0
}

/** Removes the group row; FK on `map_layout_positions.manual_group_id` clears membership (devices unchanged on disk). */
export function deleteManualGroup(db: Database.Database, id: string): boolean {
  return db.prepare(`DELETE FROM map_manual_groups WHERE id = ?`).run(id).changes > 0
}

/**
 * Persist group bounds/name after drag or rename from layout save (batch).
 * Only updates rows that belong to `networkId`.
 */
export function upsertManualGroupLayouts(
  db: Database.Database,
  networkId: string,
  layouts: MapManualGroupLayoutInput[]
): void {
  const iso = new Date().toISOString()
  const stmt = db.prepare(
    `UPDATE map_manual_groups
     SET name = @name, pos_x = @x, pos_y = @y, width = @w, height = @h, updated_at = @u
     WHERE id = @id AND network_id = @nid`
  )
  const run = db.transaction((items: MapManualGroupLayoutInput[]) => {
    for (const g of items) {
      stmt.run({
        id: g.id,
        nid: networkId,
        name: g.name.trim() || 'Group',
        x: g.x,
        y: g.y,
        w: g.width,
        h: g.height,
        u: iso
      })
    }
  })
  run(layouts)
}

function normalizeManualGroupId(
  db: Database.Database,
  networkId: string,
  nodeKey: string,
  requested: string | null | undefined
): string | null {
  if (nodeKey === MAP_LAYOUT_GATEWAY_KEY) return null
  if (!requested?.trim()) return null
  const id = requested.trim()
  const ok = db
    .prepare(`SELECT 1 FROM map_manual_groups WHERE id = ? AND network_id = ?`)
    .get(id, networkId)
  return ok ? id : null
}

/** Positions + optional `manual_group_id` membership (at most one group per device node). */
export function listMapLayoutForNetwork(db: Database.Database, networkId: string): MapLayoutSnapshot {
  const rows = db
    .prepare(
      `SELECT node_key, pos_x, pos_y, manual_group_id FROM map_layout_positions WHERE network_id = @nid`
    )
    .all({ nid: networkId }) as {
      node_key: string
      pos_x: number
      pos_y: number
      manual_group_id: string | null
    }[]
  const out: MapLayoutSnapshot = {}
  for (const r of rows) {
    out[r.node_key] = {
      x: r.pos_x,
      y: r.pos_y,
      manualGroupId: r.manual_group_id ?? null
    }
  }
  return out
}

export function getMapLayoutBundle(db: Database.Database, networkId: string): MapLayoutBundle {
  return {
    manualGroups: listManualGroupsForNetwork(db, networkId),
    positions: listMapLayoutForNetwork(db, networkId)
  }
}

export function upsertMapLayoutPositions(
  db: Database.Database,
  networkId: string,
  positions: MapLayoutPositionInput[]
): void {
  const iso = new Date().toISOString()
  const stmt = db.prepare(
    `INSERT INTO map_layout_positions (network_id, node_key, pos_x, pos_y, updated_at, manual_group_id)
     VALUES (@networkId, @nodeKey, @x, @y, @updatedAt, @gid)
     ON CONFLICT(network_id, node_key) DO UPDATE SET
       pos_x = excluded.pos_x,
       pos_y = excluded.pos_y,
       updated_at = excluded.updated_at,
       manual_group_id = excluded.manual_group_id`
  )
  const run = db.transaction((items: MapLayoutPositionInput[]) => {
    for (const p of items) {
      const gid = normalizeManualGroupId(db, networkId, p.nodeKey, p.manualGroupId ?? null)
      stmt.run({
        networkId,
        nodeKey: p.nodeKey,
        x: p.x,
        y: p.y,
        updatedAt: iso,
        gid
      })
    }
  })
  run(positions)
}

export function deleteMapLayoutRowsForNodeKey(db: Database.Database, nodeKey: string): void {
  db.prepare(`DELETE FROM map_layout_positions WHERE node_key = ?`).run(nodeKey)
}

/** Clears saved layout and all manual groups for this LAN (reset map). */
export function deleteMapLayoutForNetwork(db: Database.Database, networkId: string): void {
  db.prepare(`DELETE FROM map_layout_positions WHERE network_id = ?`).run(networkId)
  db.prepare(`DELETE FROM map_manual_groups WHERE network_id = ?`).run(networkId)
}

export function deleteAllMapLayout(db: Database.Database): void {
  db.prepare(`DELETE FROM map_layout_positions`).run()
  db.prepare(`DELETE FROM map_manual_groups`).run()
}
