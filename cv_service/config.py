import os
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent
ROOT_DIR = BASE_DIR.parent

CV_HOST = os.getenv("CV_HOST", "0.0.0.0")
CV_PORT = int(os.getenv("CV_PORT", "8000"))

YOLO_MODEL_PATH = os.getenv("YOLO_MODEL_PATH", str(BASE_DIR / "models" / "yolov8n.pt"))
YOLO_CONFIDENCE = float(os.getenv("YOLO_CONFIDENCE", "0.45"))
YOLO_IMGSZ = int(os.getenv("YOLO_IMGSZ", "640"))
INFERENCE_INTERVAL_MS = int(os.getenv("INFERENCE_INTERVAL_MS", "100"))

FACE_SIMILARITY_THRESHOLD = float(os.getenv("FACE_SIMILARITY_THRESHOLD", "0.62"))
EVENT_COOLDOWN_SEC = float(os.getenv("EVENT_COOLDOWN_SEC", "12.0"))

CROWD_NORMAL_MAX = int(os.getenv("CROWD_NORMAL_MAX", "4"))
CROWD_ELEVATED_MAX = int(os.getenv("CROWD_ELEVATED_MAX", "9"))

NODE_SERVER_URL = os.getenv("NODE_SERVER_URL", "http://localhost:3000").rstrip("/")
CV_DB_PATH = os.getenv("CV_DB_PATH", str(BASE_DIR / "visionguard_cv.db"))
EVIDENCE_DIR = Path(os.getenv("EVIDENCE_DIR", str(ROOT_DIR / "evidence")))
EVIDENCE_DIR.mkdir(parents=True, exist_ok=True)
(BASE_DIR / "models").mkdir(parents=True, exist_ok=True)

TARGET_CLASSES = {
    0: "person",
    1: "bicycle",
    2: "car",
    3: "motorcycle",
    5: "bus",
    7: "truck",
    24: "backpack",
    26: "bag",  # COCO 'handbag' mapped to 'bag'
}
