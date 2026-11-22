import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import {
  CALIBRATION_UPLOADS_ROOT,
  DATA_ROOT,
  EVIDENCE_ROOT,
  IDENTITY_UPLOADS_ROOT,
  SAMPLE_VIDEOS_ROOT,
  UPLOADS_ROOT,
} from './security.ts';

for (const dir of [
  DATA_ROOT,
  EVIDENCE_ROOT,
  SAMPLE_VIDEOS_ROOT,
  UPLOADS_ROOT,
  CALIBRATION_UPLOADS_ROOT,
  IDENTITY_UPLOADS_ROOT,
]) {
  fs.mkdirSync(dir, { recursive: true });
}

const DB_PATH = path.join(DATA_ROOT, 'visionguard.db');
export const db = new Database(DB_PATH);

db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS cameras (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    source_type TEXT NOT NULL CHECK(source_type IN ('MOBILE','WEBCAM','IP','RTSP','VIDEO_FILE')),
    stream_url TEXT,
    status TEXT NOT NULL DEFAULT 'DISCONNECTED' CHECK(status IN ('CONNECTING','CONNECTED','DISCONNECTED','RECONNECTING','ERROR')),
    resolution_width INTEGER NOT NULL DEFAULT 0,
    resolution_height INTEGER NOT NULL DEFAULT 0,
    capture_fps REAL NOT NULL DEFAULT 0,
    processing_fps REAL NOT NULL DEFAULT 0,
    inference_fps REAL NOT NULL DEFAULT 0,
    latency_ms REAL NOT NULL DEFAULT 0,
    frame_count INTEGER NOT NULL DEFAULT 0,
    brightness REAL NOT NULL DEFAULT 0,
    contrast REAL NOT NULL DEFAULT 0,
    is_active INTEGER NOT NULL DEFAULT 0,
    last_error TEXT,
    last_frame_at TEXT,
    ingest_token TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS calibrations (
    id TEXT PRIMARY KEY,
    camera_id TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'NOT_CALIBRATED' CHECK(status IN ('NOT_CALIBRATED','CALIBRATED','CALIBRATION_FAILED')),
    chessboard_cols INTEGER NOT NULL DEFAULT 9,
    chessboard_rows INTEGER NOT NULL DEFAULT 6,
    square_size_mm REAL NOT NULL DEFAULT 25.0,
    image_count INTEGER NOT NULL DEFAULT 0,
    valid_image_count INTEGER NOT NULL DEFAULT 0,
    camera_matrix_json TEXT,
    dist_coeffs_json TEXT,
    reprojection_error REAL,
    scale_meters_per_pixel REAL,
    calibrated_at TEXT,
    error_message TEXT,
    created_at TEXT NOT NULL,
    FOREIGN KEY (camera_id) REFERENCES cameras(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS identities (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    role_label TEXT NOT NULL DEFAULT 'Authorized Personnel',
    notes TEXT,
    enabled INTEGER NOT NULL DEFAULT 1,
    similarity_threshold REAL NOT NULL DEFAULT 0.62,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS face_embeddings (
    id TEXT PRIMARY KEY,
    identity_id TEXT NOT NULL,
    image_path TEXT NOT NULL,
    embedding_json TEXT NOT NULL,
    model_name TEXT NOT NULL DEFAULT 'ArcFace-R100',
    quality_score REAL NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    FOREIGN KEY (identity_id) REFERENCES identities(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS zones (
    id TEXT PRIMARY KEY,
    camera_id TEXT NOT NULL,
    name TEXT NOT NULL,
    zone_type TEXT NOT NULL CHECK(zone_type IN ('SAFE','RESTRICTED','MONITORING')),
    polygon_json TEXT NOT NULL,
    dwell_time_sec REAL NOT NULL DEFAULT 5.0,
    crowd_threshold INTEGER NOT NULL DEFAULT 5,
    enabled INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (camera_id) REFERENCES cameras(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS events (
    id TEXT PRIMARY KEY,
    event_type TEXT NOT NULL CHECK(event_type IN (
      'UNKNOWN_PERSON',
      'DANGER_ZONE_INTRUSION',
      'LOITERING_DETECTED',
      'CROWDING',
      'OBJECT_DETECTED',
      'ABNORMAL_MOVEMENT',
      'CAMERA_OFFLINE',
      'SYSTEM_WARNING'
    )),
    severity TEXT NOT NULL CHECK(severity IN ('LOW','MEDIUM','HIGH','CRITICAL')),
    camera_id TEXT,
    camera_name TEXT,
    track_id INTEGER,
    confidence REAL,
    description TEXT NOT NULL,
    reason TEXT,
    evidence_id TEXT,
    evidence_path TEXT,
    status TEXT NOT NULL DEFAULT 'NEW' CHECK(status IN ('NEW','ACKNOWLEDGED','RESOLVED')),
    metadata_json TEXT,
    created_at TEXT NOT NULL,
    acknowledged_at TEXT,
    resolved_at TEXT,
    FOREIGN KEY (camera_id) REFERENCES cameras(id) ON DELETE SET NULL
  );

  CREATE TABLE IF NOT EXISTS evidence (
    id TEXT PRIMARY KEY,
    event_id TEXT NOT NULL,
    camera_id TEXT,
    camera_name TEXT,
    event_type TEXT NOT NULL,
    severity TEXT NOT NULL,
    track_id INTEGER,
    confidence REAL,
    file_path TEXT NOT NULL,
    width INTEGER NOT NULL DEFAULT 0,
    height INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS telemetry_snapshots (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    camera_id TEXT NOT NULL,
    capture_fps REAL NOT NULL DEFAULT 0,
    processing_fps REAL NOT NULL DEFAULT 0,
    inference_fps REAL NOT NULL DEFAULT 0,
    latency_ms REAL NOT NULL DEFAULT 0,
    active_tracks INTEGER NOT NULL DEFAULT 0,
    people_count INTEGER NOT NULL DEFAULT 0,
    object_count INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS system_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    level TEXT NOT NULL CHECK(level IN ('INFO','WARN','ERROR')),
    module TEXT NOT NULL,
    message TEXT NOT NULL,
    details_json TEXT,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS operator_auth (
    id TEXT PRIMARY KEY,
    username TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL CHECK(role IN ('ADMIN','OPERATOR')),
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS cv_config (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_events_created ON events(created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_events_status ON events(status);
  CREATE INDEX IF NOT EXISTS idx_events_type ON events(event_type);
  CREATE INDEX IF NOT EXISTS idx_events_camera ON events(camera_id);
  CREATE INDEX IF NOT EXISTS idx_evidence_created ON evidence(created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_zones_camera ON zones(camera_id);
  CREATE INDEX IF NOT EXISTS idx_telemetry_created ON telemetry_snapshots(created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_logs_created ON system_logs(created_at DESC);
`);

const defaultConfig: Record<string, string> = {
  yolo_confidence: '0.45',
  yolo_imgsz: '640',
  inference_interval_ms: '120',
  crowd_normal_max: '4',
  crowd_elevated_max: '9',
  face_similarity_threshold: '0.62',
  event_cooldown_sec: '12',
  cv_service_url: process.env.CV_SERVICE_URL || 'http://localhost:8000',
  browser_edge_cv_enabled: 'true',
};

const insertConfig = db.prepare(`
  INSERT OR IGNORE INTO cv_config (key, value, updated_at) VALUES (?, ?, ?)
`);
const nowIso = new Date().toISOString();
for (const [k, v] of Object.entries(defaultConfig)) {
  insertConfig.run(k, v, nowIso);
}

export function logSystem(
  level: 'INFO' | 'WARN' | 'ERROR',
  moduleName: string,
  message: string,
  details?: Record<string, unknown>
): void {
  try {
    db.prepare(
      `INSERT INTO system_logs (level, module, message, details_json, created_at) VALUES (?, ?, ?, ?, ?)`
    ).run(level, moduleName, message, details ? JSON.stringify(details) : null, new Date().toISOString());
  } catch (err) {
    console.error('[SystemLog write failed]', err);
  }
}

export function getConfigMap(): Record<string, string> {
  const rows = db.prepare(`SELECT key, value FROM cv_config`).all() as Array<{ key: string; value: string }>;
  const map: Record<string, string> = {};
  for (const r of rows) {
    map[r.key] = r.value;
  }
  return map;
}
