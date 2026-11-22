import base64
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
import time
from typing import Any, Dict, Optional, Tuple
import uuid
import cv2
import numpy as np
import requests
from config import EVIDENCE_DIR, EVENT_COOLDOWN_SEC, NODE_SERVER_URL
from database import insert_cv_event


class EventEngine:
    """Module 3: Central Event Engine with deduplication, cooldown, and non-blocking Evidence Manager."""

    def __init__(self) -> None:
        self.cooldown_sec = EVENT_COOLDOWN_SEC
        self.last_fired: Dict[Tuple[str, str, Optional[int]], float] = {}
        self.executor = ThreadPoolExecutor(max_workers=2, thread_name_prefix="evidence-writer")

    def process_candidate(self, candidate: Dict[str, Any], frame: Optional[np.ndarray] = None) -> Optional[Dict[str, Any]]:
        now_ts = time.time()
        key = (candidate["event_type"], candidate.get("camera_id") or "", candidate.get("track_id"))
        prev = self.last_fired.get(key)
        if prev is not None and (now_ts - prev) < self.cooldown_sec:
            return None

        self.last_fired[key] = now_ts
        now_dt = datetime.now(timezone.utc)
        event_id = f"evt_{int(now_ts * 1000)}_{uuid.uuid4().hex[:6]}"
        severity = candidate["severity"]

        evidence_rel_path: Optional[str] = None
        snapshot_data_url: Optional[str] = None
        width = height = 0

        if frame is not None and severity in ("HIGH", "CRITICAL", "MEDIUM"):
            height, width = frame.shape[:2]
            year = f"{now_dt.year}"
            month = f"{now_dt.month:02d}"
            evidence_rel_path = f"{year}/{month}/{event_id}/snapshot.jpg"
            ok, encoded = cv2.imencode(".jpg", frame, [int(cv2.IMWRITE_JPEG_QUALITY), 88])
            if ok:
                jpg_bytes = encoded.tobytes()
                snapshot_data_url = "data:image/jpeg;base64," + base64.b64encode(jpg_bytes).decode("ascii")
                target_file = EVIDENCE_DIR / year / month / event_id / "snapshot.jpg"
                self.executor.submit(self._write_evidence_file, target_file, jpg_bytes)

        event_record = {
            "id": event_id,
            "event_type": candidate["event_type"],
            "severity": severity,
            "camera_id": candidate.get("camera_id"),
            "camera_name": candidate.get("camera_name"),
            "track_id": candidate.get("track_id"),
            "confidence": candidate.get("confidence"),
            "description": candidate["description"],
            "reason": candidate.get("reason"),
            "evidence_path": evidence_rel_path,
            "created_at": now_dt.isoformat(),
        }

        self.executor.submit(insert_cv_event, event_record)
        self.executor.submit(self._forward_to_node_server, candidate, snapshot_data_url, width, height)
        return event_record

    @staticmethod
    def _write_evidence_file(target_path, jpg_bytes: bytes) -> None:
        try:
            target_path.parent.mkdir(parents=True, exist_ok=True)
            target_path.write_bytes(jpg_bytes)
        except Exception:
            pass

    @staticmethod
    def _forward_to_node_server(
        candidate: Dict[str, Any], snapshot_data_url: Optional[str], width: int, height: int
    ) -> None:
        try:
            requests.post(
                f"{NODE_SERVER_URL}/api/events/ingest",
                json={
                    **candidate,
                    "snapshot_data_url": snapshot_data_url,
                    "width": width,
                    "height": height,
                },
                timeout=3.0,
            )
        except Exception:
            pass
