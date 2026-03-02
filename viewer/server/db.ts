import Database from 'better-sqlite3';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';

// ---------------------------------------------------------------------------
// Parameter defaults — must stay in sync with viewer/src/configParams.ts
// ---------------------------------------------------------------------------

const PARAM_DEFAULTS: Record<string, string> = {
  isDefault:        JSON.stringify({ enabled: false }),
  doorStyles:       JSON.stringify({ entries: [] }),
  stileMin:         JSON.stringify({ value: 44.45 }),   // 1.75"
  stileMax:         JSON.stringify({ value: 88.9 }),    // 3.5"
  stileCustomMin:   JSON.stringify({ value: 38.1 }),    // 1.5"
  railMin:          JSON.stringify({ value: 44.45 }),
  railMax:          JSON.stringify({ value: 88.9 }),
  railCustomMin:    JSON.stringify({ value: 38.1 }),
  midStileDefaultW: JSON.stringify({ value: 63.5 }),  // 2.5"
  midRailDefaultW:  JSON.stringify({ value: 63.5 }),  // 2.5"
  stileRailPresets: JSON.stringify({ enabledWidths: [] }),
  hasEdges:         JSON.stringify({ enabledGroupIds: [] }),
  glassToolGroup:   JSON.stringify({ enabledGroupIds: [] }),
  panelTypes:       JSON.stringify({ enabledOptions: ['pocket', 'raised', 'glass'] }),
  backOperations:   JSON.stringify({ enabledOptions: ['none', 'back-route', 'back-pocket', 'back-bridge', 'custom'] }),
  doorTypes:        JSON.stringify({ enabledOptions: ['door', 'drawer', 'reduced-rail', 'slab', 'end-panel'] }),
  backRouteGroups:  JSON.stringify({ entries: [] }),
  backPocketGroups: JSON.stringify({ entries: [] }),
  backCustomGroups: JSON.stringify({ entries: [] }),
  hinge3Trigger:    JSON.stringify({ value: 762 }),       // 30" — min height for 3 hinges
  hinge4Trigger:    JSON.stringify({ value: 1219.2 }),    // 48" — min height for 4 hinges
  hinge5Trigger:    JSON.stringify({ value: 1828.8 }),    // 72" — min height for 5 hinges
  hinge6Trigger:    JSON.stringify({ value: 0 }),         // disabled
  hingeEdgeDistance: JSON.stringify({ value: 76.2 }),      // 3"
  textures:         JSON.stringify({ enabledTextures: [] }),
};

// ---------------------------------------------------------------------------
// Database singleton
// ---------------------------------------------------------------------------

let db: Database.Database | null = null;

export function getDb(viewerRoot: string): Database.Database {
  if (db) return db;
  const dbPath = resolve(viewerRoot, '.pac-doorstyles.db');
  db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  initSchema(db);
  ensureDefaultProfile(db);
  return db;
}

function initSchema(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS profiles (
      id         TEXT PRIMARY KEY,
      name       TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS door_styles (
      id          TEXT PRIMARY KEY,
      profile_id  TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
      display_name TEXT NOT NULL,
      sort_order  INTEGER NOT NULL DEFAULT 0,
      created_at  TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at  TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(profile_id, display_name)
    );
    CREATE TABLE IF NOT EXISTS style_config (
      id            TEXT PRIMARY KEY,
      door_style_id TEXT NOT NULL REFERENCES door_styles(id) ON DELETE CASCADE,
      param_key     TEXT NOT NULL,
      value         TEXT NOT NULL,
      updated_at    TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(door_style_id, param_key)
    );
  `);
}

function ensureDefaultProfile(db: Database.Database): void {
  const row = db.prepare('SELECT id FROM profiles WHERE id = ?').get('default');
  if (!row) {
    db.prepare('INSERT INTO profiles (id, name) VALUES (?, ?)').run('default', 'Default Profile');
  }
}

// ---------------------------------------------------------------------------
// Query helpers
// ---------------------------------------------------------------------------

export interface DoorStyleRow {
  id: string;
  displayName: string;
  sortOrder: number;
}

export interface DoorStyleWithParams extends DoorStyleRow {
  params: Record<string, unknown>;
}

export function getAllStylesWithParams(
  viewerRoot: string,
  profileId = 'default',
): DoorStyleWithParams[] {
  const d = getDb(viewerRoot);

  const styles = d.prepare(
    'SELECT id, display_name, sort_order FROM door_styles WHERE profile_id = ? ORDER BY sort_order, display_name',
  ).all(profileId) as { id: string; display_name: string; sort_order: number }[];

  const configRows = d.prepare(
    'SELECT door_style_id, param_key, value FROM style_config WHERE door_style_id IN (SELECT id FROM door_styles WHERE profile_id = ?)',
  ).all(profileId) as { door_style_id: string; param_key: string; value: string }[];

  const configMap = new Map<string, Record<string, unknown>>();
  for (const row of configRows) {
    let entry = configMap.get(row.door_style_id);
    if (!entry) { entry = {}; configMap.set(row.door_style_id, entry); }
    try { entry[row.param_key] = JSON.parse(row.value); }
    catch { entry[row.param_key] = row.value; }
  }

  return styles.map(s => ({
    id: s.id,
    displayName: s.display_name,
    sortOrder: s.sort_order,
    params: configMap.get(s.id) ?? {},
  }));
}

export function createDoorStyle(
  viewerRoot: string,
  displayName: string,
  profileId = 'default',
): DoorStyleWithParams {
  const d = getDb(viewerRoot);
  const id = randomUUID();

  const maxOrder = (d.prepare(
    'SELECT MAX(sort_order) as mx FROM door_styles WHERE profile_id = ?',
  ).get(profileId) as { mx: number | null })?.mx ?? -1;

  d.prepare(
    'INSERT INTO door_styles (id, profile_id, display_name, sort_order) VALUES (?, ?, ?, ?)',
  ).run(id, profileId, displayName, maxOrder + 1);

  // Populate all parameter defaults
  const insert = d.prepare(
    'INSERT INTO style_config (id, door_style_id, param_key, value) VALUES (?, ?, ?, ?)',
  );
  const params: Record<string, unknown> = {};
  for (const [key, defaultValue] of Object.entries(PARAM_DEFAULTS)) {
    insert.run(randomUUID(), id, key, defaultValue);
    try { params[key] = JSON.parse(defaultValue); }
    catch { params[key] = defaultValue; }
  }

  return { id, displayName, sortOrder: maxOrder + 1, params };
}

export function renameDoorStyle(viewerRoot: string, styleId: string, newName: string): void {
  const d = getDb(viewerRoot);
  d.prepare("UPDATE door_styles SET display_name = ?, updated_at = datetime('now') WHERE id = ?")
    .run(newName, styleId);
}

export function deleteDoorStyle(viewerRoot: string, styleId: string): void {
  const d = getDb(viewerRoot);
  d.prepare('DELETE FROM door_styles WHERE id = ?').run(styleId);
}

export function upsertParam(
  viewerRoot: string,
  styleId: string,
  paramKey: string,
  value: unknown,
): void {
  const d = getDb(viewerRoot);
  const jsonValue = JSON.stringify(value);
  const existing = d.prepare(
    'SELECT id FROM style_config WHERE door_style_id = ? AND param_key = ?',
  ).get(styleId, paramKey) as { id: string } | undefined;

  if (existing) {
    d.prepare(
      "UPDATE style_config SET value = ?, updated_at = datetime('now') WHERE id = ?",
    ).run(jsonValue, existing.id);
  } else {
    d.prepare(
      'INSERT INTO style_config (id, door_style_id, param_key, value) VALUES (?, ?, ?, ?)',
    ).run(randomUUID(), styleId, paramKey, jsonValue);
  }
}

/** Reorder door styles by updating sort_order. */
export function reorderDoorStyles(viewerRoot: string, styleIds: string[], profileId = 'default'): void {
  const d = getDb(viewerRoot);
  const stmt = d.prepare("UPDATE door_styles SET sort_order = ?, updated_at = datetime('now') WHERE id = ? AND profile_id = ?");
  const txn = d.transaction(() => {
    styleIds.forEach((id, i) => stmt.run(i, id, profileId));
  });
  txn();
}

/** Clear isDefault on all styles except the given one (server-side radio enforcement). */
export function clearOtherDefaults(viewerRoot: string, keepStyleId: string): void {
  const d = getDb(viewerRoot);
  d.prepare(
    "UPDATE style_config SET value = ?, updated_at = datetime('now') WHERE param_key = 'isDefault' AND door_style_id != ?",
  ).run(JSON.stringify({ enabled: false }), keepStyleId);
}
