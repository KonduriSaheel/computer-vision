import json
import sqlite3
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional
from config import CV_DB_PATH


def get_conn() -> sqlite3.Connection:
    conn = sqlite3.connect(CV_DB_PATH, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL;")
    conn.execute("PRAGMA foreign_keys=ON;")
    return conn


def init_db() -> None:
    conn = get_conn()
    try:
        conn.executescript(
            """
            CREATE TABLE IF NOT EXISTS cv_cameras (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                source_type TEXT NOT NULL,
                stream_url TEXT,
                status TEXT NOT NULL DEFAULT 'DISCONNECTED',
                updated_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS cv_calibrations (
                camera_id TEXT PRIMARY KEY,
                status TEXT NOT NULL,
                chessboard_cols INTEGER NOT NULL,
                chessboard_rows INTEGER NOT NULL,
                square_size_mm REAL NOT NULL,
                valid_image_count INTEGER NOT NULL,
                camera_matrix_json TEXT,
                dist_coeffs_json TEXT,
                reprojection_error REAL,
                calibrated_at TEXT
            );

            CREATE TABLE IF NOT EXISTS cv_face_embeddings (
                id TEXT PRIMARY KEY,
                identity_id TEXT NOT NULL,
                identity_name TEXT NOT NULL,
                embedding_json TEXT NOT NULL,
                model_name TEXT NOT NULL,
                created_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS cv_events (
                id TEXT PRIMARY KEY,
                event_type TEXT NOT NULL,
                severity TEXT NOT NULL,
                camera_id TEXT,
                track_id INTEGER,
                confidence REAL,
                description TEXT NOT NULL,
                reason TEXT,
                evidence_path TEXT,
                created_at TEXT NOT NULL
            );
            """
        )
        conn.commit()
    finally:
        conn.close()


def save_calibration(
    camera_id: str,
    status: str,
    cols: int,
    rows: int,
    square_size_mm: float,
    valid_count: int,
    camera_matrix: Optional[List[List[float]]],
    dist_coeffs: Optional[List[float]],
    reprojection_error: Optional[float],
) -> None:
    conn = get_conn()
    try:
        now = datetime.now(timezone.utc).isoformat()
        conn.execute(
            """
            INSERT INTO cv_calibrations (
                camera_id, status, chessboard_cols, chessboard_rows, square_size_mm,
                valid_image_count, camera_matrix_json, dist_coeffs_json, reprojection_error, calibrated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(camera_id) DO UPDATE SET
                status=excluded.status,
                chessboard_cols=excluded.chessboard_cols,
                chessboard_rows=excluded.chessboard_rows,
                square_size_mm=excluded.square_size_mm,
                valid_image_count=excluded.valid_image_count,
                camera_matrix_json=excluded.camera_matrix_json,
                dist_coeffs_json=excluded.dist_coeffs_json,
                reprojection_error=excluded.reprojection_error,
                calibrated_at=excluded.calibrated_at
            """,
            (
                camera_id,
                status,
                cols,
                rows,
                square_size_mm,
                valid_count,
                json.dumps(camera_matrix) if camera_matrix else None,
                json.dumps(dist_coeffs) if dist_coeffs else None,
                reprojection_error,
                now if status == "CALIBRATED" else None,
            ),
        )
        conn.commit()
    finally:
        conn.close()


def list_face_embeddings() -> List[Dict[str, Any]]:
    conn = get_conn()
    try:
        rows = conn.execute("SELECT * FROM cv_face_embeddings").fetchall()
        return [dict(r) for r in rows]
    finally:
        conn.close()


def insert_cv_event(event: Dict[str, Any]) -> None:
    conn = get_conn()
    try:
        conn.execute(
            """
            INSERT OR IGNORE INTO cv_events (
                id, event_type, severity, camera_id, track_id, confidence,
                description, reason, evidence_path, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                event["id"],
                event["event_type"],
                event["severity"],
                event.get("camera_id"),
                event.get("track_id"),
                event.get("confidence"),
                event["description"],
                event.get("reason"),
                event.get("evidence_path"),
                event["created_at"],
            ),
        )
        conn.commit()
    finally:
        conn.close()
