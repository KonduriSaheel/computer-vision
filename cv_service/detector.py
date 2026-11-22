from collections import defaultdict, deque
import math
import time
from typing import Any, Dict, List, Optional, Tuple
import numpy as np
from config import TARGET_CLASSES, YOLO_CONFIDENCE, YOLO_IMGSZ, YOLO_MODEL_PATH


class YoloByteTrackPipeline:
    """Module 4: Lightweight Ultralytics YOLO detection + ByteTrack multi-object tracking."""

    def __init__(self) -> None:
        self.model = None
        self.model_loaded = False
        self.load_error: Optional[str] = None
        self.conf_threshold = YOLO_CONFIDENCE
        self.imgsz = YOLO_IMGSZ
        self.trajectories: Dict[int, deque] = defaultdict(lambda: deque(maxlen=30))
        self.prev_positions: Dict[int, Tuple[float, float, float]] = {}
        self.load_model()

    def load_model(self) -> None:
        try:
            from ultralytics import YOLO

            self.model = YOLO(YOLO_MODEL_PATH)
            self.model_loaded = True
            self.load_error = None
        except Exception as exc:
            self.model = None
            self.model_loaded = False
            self.load_error = (
                f"Ultralytics YOLO weights unavailable at {YOLO_MODEL_PATH}. "
                f"Run setup_windows.bat or allow ultralytics to download yolov8n.pt. ({exc})"
            )

    def detect_and_track(self, frame: np.ndarray, conf: Optional[float] = None, imgsz: Optional[int] = None) -> List[Dict[str, Any]]:
        if not self.model_loaded or self.model is None:
            return []

        h, w = frame.shape[:2]
        use_conf = conf if conf is not None else self.conf_threshold
        use_imgsz = imgsz if imgsz is not None else self.imgsz
        target_ids = list(TARGET_CLASSES.keys())

        results = self.model.track(
            source=frame,
            persist=True,
            tracker="bytetrack.yaml",
            conf=use_conf,
            imgsz=use_imgsz,
            classes=target_ids,
            verbose=False,
        )

        detections: List[Dict[str, Any]] = []
        now = time.time()

        for res in results:
            if res.boxes is None:
                continue
            boxes = res.boxes
            xyxy_list = boxes.xyxy.cpu().numpy()
            confs = boxes.conf.cpu().numpy()
            clss = boxes.cls.cpu().numpy().astype(int)
            ids = boxes.id.cpu().numpy().astype(int) if boxes.id is not None else list(range(1, len(xyxy_list) + 1))

            for box, score, cls_id, track_id in zip(xyxy_list, confs, clss, ids):
                class_name = TARGET_CLASSES.get(int(cls_id))
                if not class_name:
                    continue
                x1, y1, x2, y2 = [float(v) for v in box]
                nx1, ny1, nx2, ny2 = max(0.0, x1 / w), max(0.0, y1 / h), min(1.0, x2 / w), min(1.0, y2 / h)
                cx_px = (x1 + x2) / 2.0
                cy_px = (y1 + y2) / 2.0
                ncx = (nx1 + nx2) / 2.0
                ncy = (ny1 + ny2) / 2.0

                displacement_px = 0.0
                velocity_px = 0.0
                if int(track_id) in self.prev_positions:
                    px, py, pt = self.prev_positions[int(track_id)]
                    dt = max(0.001, now - pt)
                    displacement_px = math.hypot(cx_px - px, cy_px - py)
                    velocity_px = displacement_px / dt
                self.prev_positions[int(track_id)] = (cx_px, cy_px, now)

                traj = self.trajectories[int(track_id)]
                traj.append([round(ncx, 4), round(ncy, 4)])

                detections.append(
                    {
                        "track_id": int(track_id),
                        "class_name": class_name,
                        "confidence": round(float(score), 3),
                        "bbox": [round(nx1, 4), round(ny1, 4), round(nx2, 4), round(ny2, 4)],
                        "center": [round(ncx, 4), round(ncy, 4)],
                        "displacement_px": round(displacement_px, 2),
                        "velocity_px_per_sec": round(velocity_px, 2),
                        "trajectory": list(traj),
                    }
                )
        return detections
