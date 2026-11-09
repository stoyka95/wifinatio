//! SQLite persistence: settings, network events, speed tests, room snapshots and
//! diagnostic reports. Payloads that the frontend owns are stored as JSON.

use std::path::Path;

use parking_lot::Mutex;
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::error::AppResult;
use crate::settings::Settings;

const SCHEMA: &str = r#"
CREATE TABLE IF NOT EXISTS settings (id INTEGER PRIMARY KEY CHECK (id = 1), json TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ts INTEGER NOT NULL,
    end_ts INTEGER,
    kind TEXT NOT NULL,
    severity TEXT NOT NULL,
    data TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_events_ts ON events(ts);
CREATE TABLE IF NOT EXISTS speedtests (id INTEGER PRIMARY KEY AUTOINCREMENT, ts INTEGER NOT NULL, room TEXT, json TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS snapshots (id INTEGER PRIMARY KEY AUTOINCREMENT, ts INTEGER NOT NULL, room TEXT NOT NULL, note TEXT, json TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS reports (id INTEGER PRIMARY KEY AUTOINCREMENT, ts INTEGER NOT NULL, json TEXT NOT NULL);
"#;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NetEvent {
    pub id: i64,
    pub ts: i64,
    pub end_ts: Option<i64>,
    pub kind: String,
    pub severity: String,
    pub data: Value,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StoredRecord {
    pub id: i64,
    pub ts: i64,
    pub room: Option<String>,
    pub note: Option<String>,
    pub data: Value,
}

#[derive(Debug, Clone, Copy, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum HistoryKind {
    Events,
    Speedtests,
    Snapshots,
    Reports,
    All,
}

pub struct Storage {
    conn: Mutex<Connection>,
}

impl Storage {
    pub fn open(path: &Path) -> AppResult<Self> {
        let conn = Connection::open(path)?;
        Self::init(conn)
    }

    #[cfg(test)]
    pub fn open_in_memory() -> AppResult<Self> {
        Self::init(Connection::open_in_memory()?)
    }

    fn init(conn: Connection) -> AppResult<Self> {
        conn.pragma_update(None, "journal_mode", "WAL")?;
        conn.execute_batch(SCHEMA)?;
        Ok(Self { conn: Mutex::new(conn) })
    }

    pub fn load_settings(&self) -> Settings {
        let conn = self.conn.lock();
        let json: Option<String> = conn
            .query_row("SELECT json FROM settings WHERE id = 1", [], |r| r.get(0))
            .optional()
            .unwrap_or(None);
        json.and_then(|j| serde_json::from_str(&j).ok()).unwrap_or_default()
    }

    pub fn save_settings(&self, settings: &Settings) -> AppResult<()> {
        let json = serde_json::to_string(settings)?;
        self.conn.lock().execute(
            "INSERT INTO settings (id, json) VALUES (1, ?1) ON CONFLICT(id) DO UPDATE SET json = excluded.json",
            params![json],
        )?;
        Ok(())
    }

    pub fn insert_event(&self, ts: i64, kind: &str, severity: &str, data: &Value) -> AppResult<NetEvent> {
        let conn = self.conn.lock();
        conn.execute(
            "INSERT INTO events (ts, kind, severity, data) VALUES (?1, ?2, ?3, ?4)",
            params![ts, kind, severity, data.to_string()],
        )?;
        Ok(NetEvent {
            id: conn.last_insert_rowid(),
            ts,
            end_ts: None,
            kind: kind.to_string(),
            severity: severity.to_string(),
            data: data.clone(),
        })
    }

    pub fn close_event(&self, id: i64, end_ts: i64) -> AppResult<Option<NetEvent>> {
        let conn = self.conn.lock();
        conn.execute("UPDATE events SET end_ts = ?1 WHERE id = ?2", params![end_ts, id])?;
        conn.query_row(
            "SELECT id, ts, end_ts, kind, severity, data FROM events WHERE id = ?1",
            params![id],
            row_to_event,
        )
        .optional()
        .map_err(Into::into)
    }

    /// Events that were left open when the app quit are closed at their start time,
    /// since their real duration is unknown.
    pub fn close_dangling_events(&self) -> AppResult<()> {
        self.conn
            .lock()
            .execute("UPDATE events SET end_ts = ts WHERE end_ts IS NULL", [])?;
        Ok(())
    }

    pub fn list_events(&self, since: i64, limit: u32) -> AppResult<Vec<NetEvent>> {
        let conn = self.conn.lock();
        let mut stmt = conn.prepare(
            "SELECT id, ts, end_ts, kind, severity, data FROM events WHERE ts >= ?1 ORDER BY ts DESC LIMIT ?2",
        )?;
        let rows = stmt.query_map(params![since, limit], row_to_event)?;
        rows.collect::<Result<Vec<_>, _>>().map_err(Into::into)
    }

    pub fn insert_speedtest(&self, ts: i64, room: Option<&str>, data: &Value) -> AppResult<i64> {
        let conn = self.conn.lock();
        conn.execute(
            "INSERT INTO speedtests (ts, room, json) VALUES (?1, ?2, ?3)",
            params![ts, room, data.to_string()],
        )?;
        Ok(conn.last_insert_rowid())
    }

    pub fn list_speedtests(&self, limit: u32) -> AppResult<Vec<StoredRecord>> {
        self.list_records("SELECT id, ts, room, NULL, json FROM speedtests ORDER BY ts DESC LIMIT ?1", limit)
    }

    pub fn insert_snapshot(&self, ts: i64, room: &str, note: Option<&str>, data: &Value) -> AppResult<i64> {
        let conn = self.conn.lock();
        conn.execute(
            "INSERT INTO snapshots (ts, room, note, json) VALUES (?1, ?2, ?3, ?4)",
            params![ts, room, note, data.to_string()],
        )?;
        Ok(conn.last_insert_rowid())
    }

    pub fn list_snapshots(&self, limit: u32) -> AppResult<Vec<StoredRecord>> {
        self.list_records("SELECT id, ts, room, note, json FROM snapshots ORDER BY ts DESC LIMIT ?1", limit)
    }

    pub fn delete_snapshot(&self, id: i64) -> AppResult<()> {
        self.conn.lock().execute("DELETE FROM snapshots WHERE id = ?1", params![id])?;
        Ok(())
    }

    pub fn insert_report(&self, ts: i64, data: &Value) -> AppResult<i64> {
        let conn = self.conn.lock();
        conn.execute("INSERT INTO reports (ts, json) VALUES (?1, ?2)", params![ts, data.to_string()])?;
        Ok(conn.last_insert_rowid())
    }

    pub fn list_reports(&self, limit: u32) -> AppResult<Vec<StoredRecord>> {
        self.list_records("SELECT id, ts, NULL, NULL, json FROM reports ORDER BY ts DESC LIMIT ?1", limit)
    }

    pub fn clear(&self, kind: HistoryKind) -> AppResult<()> {
        let sql = match kind {
            HistoryKind::Events => "DELETE FROM events",
            HistoryKind::Speedtests => "DELETE FROM speedtests",
            HistoryKind::Snapshots => "DELETE FROM snapshots",
            HistoryKind::Reports => "DELETE FROM reports",
            HistoryKind::All => {
                "DELETE FROM events; DELETE FROM speedtests; DELETE FROM snapshots; DELETE FROM reports;"
            }
        };
        self.conn.lock().execute_batch(sql)?;
        Ok(())
    }

    fn list_records(&self, sql: &str, limit: u32) -> AppResult<Vec<StoredRecord>> {
        let conn = self.conn.lock();
        let mut stmt = conn.prepare(sql)?;
        let rows = stmt.query_map(params![limit], |r| {
            let json: String = r.get(4)?;
            Ok(StoredRecord {
                id: r.get(0)?,
                ts: r.get(1)?,
                room: r.get(2)?,
                note: r.get(3)?,
                data: serde_json::from_str(&json).unwrap_or(Value::Null),
            })
        })?;
        rows.collect::<Result<Vec<_>, _>>().map_err(Into::into)
    }
}

fn row_to_event(r: &rusqlite::Row<'_>) -> rusqlite::Result<NetEvent> {
    let data: String = r.get(5)?;
    Ok(NetEvent {
        id: r.get(0)?,
        ts: r.get(1)?,
        end_ts: r.get(2)?,
        kind: r.get(3)?,
        severity: r.get(4)?,
        data: serde_json::from_str(&data).unwrap_or(Value::Null),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn settings_round_trip() {
        let db = Storage::open_in_memory().unwrap();
        assert_eq!(db.load_settings(), Settings::default());
        let s = Settings { ping_interval_ms: 2000, ..Settings::default() };
        db.save_settings(&s).unwrap();
        assert_eq!(db.load_settings().ping_interval_ms, 2000);
    }

    #[test]
    fn events_open_and_close() {
        let db = Storage::open_in_memory().unwrap();
        let ev = db.insert_event(1000, "disconnected", "bad", &json!({"ssid": "Home"})).unwrap();
        let closed = db.close_event(ev.id, 5000).unwrap().unwrap();
        assert_eq!(closed.end_ts, Some(5000));
        let list = db.list_events(0, 10).unwrap();
        assert_eq!(list.len(), 1);
        assert_eq!(list[0].data["ssid"], "Home");
    }

    #[test]
    fn snapshots_and_clear() {
        let db = Storage::open_in_memory().unwrap();
        db.insert_snapshot(1, "Ložnice", Some("před"), &json!({"rssi": -60})).unwrap();
        assert_eq!(db.list_snapshots(10).unwrap()[0].room.as_deref(), Some("Ložnice"));
        db.clear(HistoryKind::All).unwrap();
        assert!(db.list_snapshots(10).unwrap().is_empty());
    }
}
