// Global (not per-event) icon-sync configuration. When enabled, every event
// EXCEPT source_event_id reads its bottom-nav / header / mission-appearance
// icon config from source_event_id's own rows instead of its own -- see
// resolveIconSyncEventId below, which is the single choke point every
// affected read path calls before querying.
//
// Deliberately its own table, not an app_settings row: app_settings' PK is
// (event_id, key) with event_id NOT NULL FK->events -- there is no
// "global, no event" row shape to fit into there without bending that
// constraint. A dedicated singleton table is cleaner.
import { query } from './db';

let tableEnsured = false;

async function ensureIconSyncConfigTable() {
  if (tableEnsured) return;
  await query(`
    CREATE TABLE IF NOT EXISTS icon_sync_config (
      id SMALLINT PRIMARY KEY DEFAULT 1,
      enabled BOOLEAN NOT NULL DEFAULT false,
      source_event_id INTEGER REFERENCES events(id),
      updated_at TIMESTAMP DEFAULT NOW(),
      CONSTRAINT icon_sync_config_singleton CHECK (id = 1)
    )
  `);
  await query(`
    INSERT INTO icon_sync_config (id, enabled, source_event_id)
    VALUES (1, false, NULL)
    ON CONFLICT (id) DO NOTHING
  `);
  tableEnsured = true;
}

export async function getIconSyncConfig() {
  await ensureIconSyncConfigTable();
  const { rows } = await query(
    'SELECT enabled, source_event_id FROM icon_sync_config WHERE id = 1'
  );
  return rows[0] ?? { enabled: false, source_event_id: null };
}

// Given the event id a request actually resolved to, returns the event id
// that should ACTUALLY be queried for bottom-nav/header/mission-appearance
// icon config: the source event's id for every follower, unchanged for the
// source event itself or when sync is off.
//
// Callers must use this same returned id both for the DB query AND as the
// unstable_cache argument -- sharing the cache key with the source event is
// what makes the source admin's existing revalidateTag call reach every
// follower for free, with no extra per-follower invalidation loop needed.
export async function resolveIconSyncEventId(eventId) {
  const cfg = await getIconSyncConfig();
  if (cfg.enabled && cfg.source_event_id && cfg.source_event_id !== eventId) {
    return cfg.source_event_id;
  }
  return eventId;
}
