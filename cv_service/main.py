import asyncio
import base64
from collections import Counter
import time
from typing import Any, Dict, List, Optional, Set
import cv2
from fastapi import FastAPI, File, Form, UploadFile, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
import psutil
from pydantic import BaseModel
import requests

from calibration import run_chessboard_calibration
from camera_manager import CameraSource, create_camera_source
from config import INFERENCE_INTERVAL_MS, NODE_SERVER_URL, YOLO_MODEL_PATH
from database import init_db
from detector import YoloByteTrackPipeline
from event_engine import EventEngine
from face_recognition_mod import FaceRecognitionSubsystem
from zone_activity import ZoneActivityEngine

init_db()

app = FastAPI(title="VisionGuard Python CV Service", version="1.0.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

yolo_pipeline = YoloByteTrackPipeline()
face_subsystem = FaceRecognitionSubsystem()
zone_engine = ZoneActivityEngine()
event_engine = EventEngine()

active_cameras: Dict[str, CameraSource] = {}
camera_zones: Dict[str, List[Dict[str, Any]]] = {}
ws_clients: Set[WebSocket] = set()
pipeline_tasks: Dict[str, asyncio.Task] = {}


class TestCameraRequest(BaseModel):
    source_type: str
    stream_url: str


class StartCameraRequest(BaseModel):
    camera_id: str
    name: str
    source_type: str
    stream_url: Optional[str] = None
    zones: List[Dict[str, Any]] = []


@app.get("/health")
def health() -> Dict[str, Any]:
    gpu_available = False
    gpu_name = None
    try:
        import torch

        if torch.cuda.is_available():
            gpu_available = True
            gpu_name = torch.cuda.get_device_name(0)
    except Exception:
        pass

    return {
        "status": "ok",
        "yolo_loaded": yolo_pipeline.model_loaded,
        "yolo_model": YOLO_MODEL_PATH,
        "yolo_error": yolo_pipeline.load_error,
        "face_loaded": face_subsystem.loaded,
        "face_error": face_subsystem.load_error,
        "gpu_available": gpu_available,
        "gpu_name": gpu_name,
        "cpu_pct": psutil.cpu_percent(),
        "ram_pct": psutil.virtual_memory().percent,
        "active_cameras": len(active_cameras),
    }


@app.post("/api/cameras/test")
def test_camera(req: TestCameraRequest) -> Dict[str, Any]:
    src = create_camera_source("test", "Test", req.source_type, req.stream_url)
    try:
        cap = src.open_capture()
        if not cap or not cap.isOpened():
            return {"ok": False, "error": f"OpenCV failed to open {req.source_type} stream."}
        ok, frame = cap.read()
        cap.release()
        if not ok or frame is None:
            return {"ok": False, "error": "Stream opened, but no valid video frame was decoded."}
        h, w = frame.shape[:2]
        return {"ok": True, "width": w, "height": h, "message": f"Decoded live frame ({w}x{h}) via OpenCV."}
    except Exception as exc:
        return {"ok": False, "error": str(exc)}


@app.post("/api/cameras/start")
async def start_camera(req: StartCameraRequest) -> Dict[str, Any]:
    if req.camera_id in active_cameras:
        active_cameras[req.camera_id].stop()
    camera_zones[req.camera_id] = req.zones
    src = create_camera_source(req.camera_id, req.name, req.source_type, req.stream_url)
    src.start()
    active_cameras[req.camera_id] = src
    task = asyncio.create_task(run_camera_pipeline(src))
    pipeline_tasks[req.camera_id] = task
    return {"ok": True, "camera_id": req.camera_id, "status": src.status}


@app.post("/api/cameras/{camera_id}/stop")
async def stop_camera(camera_id: str) -> Dict[str, Any]:
    if camera_id in pipeline_tasks:
        pipeline_tasks[camera_id].cancel()
        del pipeline_tasks[camera_id]
    if camera_id in active_cameras:
        active_cameras[camera_id].stop()
        del active_cameras[camera_id]
    return {"ok": True}


@app.post("/api/face/extract-embedding")
async def extract_face_embedding(image: UploadFile = File(...)) -> Dict[str, Any]:
    raw = await image.read()
    return face_subsystem.extract_embedding_from_bytes(raw)


@app.post("/api/calibration/run")
async def run_calibration_endpoint(
    camera_id: str = Form(...),
    chessboard_cols: int = Form(9),
    chessboard_rows: int = Form(6),
    square_size_mm: float = Form(25.0),
    images: List[UploadFile] = File(...),
) -> Dict[str, Any]:
    buffers = [await f.read() for f in images]
    return run_chessboard_calibration(
        camera_id=camera_id,
        image_buffers=buffers,
        cols=chessboard_cols,
        rows=chessboard_rows,
        square_size_mm=square_size_mm,
    )


@app.websocket("/ws/live")
async def ws_live(websocket: WebSocket) -> None:
    await websocket.accept()
    ws_clients.add(websocket)
    try:
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        ws_clients.discard(websocket)


async def broadcast_ws(message: Dict[str, Any]) -> None:
    dead = []
    for ws in ws_clients:
        try:
            await ws.send_json(message)
        except Exception:
            dead.append(ws)
    for ws in dead:
        ws_clients.discard(ws)


async def run_camera_pipeline(src: CameraSource) -> None:
    last_inference_ts = 0.0
    proc_times = []
    while src.camera_id in active_cameras:
        pkt = await asyncio.to_thread(src.read_latest, 0.25)
        if pkt is None:
            await asyncio.sleep(0.02)
            continue

        t0 = time.time()
        interval_sec = INFERENCE_INTERVAL_MS / 1000.0
        detections: List[Dict[str, Any]] = []
        inf_fps = 0.0

        if t0 - last_inference_ts >= interval_sec:
            t_inf_start = time.time()
            detections = await asyncio.to_thread(yolo_pipeline.detect_and_track, pkt.frame)
            inf_dt = max(0.001, time.time() - t_inf_start)
            inf_fps = round(1.0 / inf_dt, 1)
            last_inference_ts = t0

            # Optional Face Recognition on tracked persons
            if face_subsystem.loaded:
                for det in detections:
                    if det["class_name"] == "person":
                        match = await asyncio.to_thread(face_subsystem.match_person_crop, pkt.frame, det["bbox"])
                        if match:
                            det["identity"] = match
                            if not match["known"]:
                                event_engine.process_candidate(
                                    {
                                        "event_type": "UNKNOWN_PERSON",
                                        "severity": "MEDIUM",
                                        "camera_id": src.camera_id,
                                        "camera_name": src.name,
                                        "track_id": det["track_id"],
                                        "confidence": match["confidence"],
                                        "description": f"Unknown person detected on {src.name} (Track #{det['track_id']:02d})",
                                        "reason": f"Face similarity {match['similarity']:.2f} below enrollment threshold.",
                                    },
                                    pkt.frame,
                                )

        zones = camera_zones.get(src.camera_id, [])
        candidates, crowd_level = zone_engine.analyze(src.camera_id, src.name, detections, zones)
        for cand in candidates:
            fired = event_engine.process_candidate(cand, pkt.frame)
            if fired:
                await broadcast_ws({"type": "alert", "event": fired})

        proc_dt = max(0.001, time.time() - t0)
        proc_times.append(proc_dt)
        if len(proc_times) > 20:
            proc_times.pop(0)
        proc_fps = round(len(proc_times) / sum(proc_times), 1)
        latency_ms = round((time.time() - pkt.captured_at) * 1000, 1)

        counts = dict(Counter(d["class_name"] for d in detections))
        ok, jpg = cv2.imencode(".jpg", pkt.frame, [int(cv2.IMWRITE_JPEG_QUALITY), 75])
        frame_url = "data:image/jpeg;base64," + base64.b64encode(jpg.tobytes()).decode("ascii") if ok else None

        payload = {
            "camera_id": src.camera_id,
            "camera_name": src.name,
            "source_type": src.source_type,
            "status": src.status,
            "engine_label": "Python CV Service (YOLOv8n + ByteTrack)",
            "timestamp": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            "capture_fps": src.capture_fps,
            "processing_fps": proc_fps,
            "inference_fps": inf_fps,
            "latency_ms": latency_ms,
            "frame_count": pkt.frame_index,
            "resolution_width": pkt.width,
            "resolution_height": pkt.height,
            "brightness": pkt.brightness,
            "contrast": pkt.contrast,
            "detections": detections,
            "object_counts": counts,
            "people_count": counts.get("person", 0),
            "active_tracks": len(detections),
            "crowd_level": crowd_level,
            "frame_data_url": frame_url,
        }

        await broadcast_ws({"type": "telemetry", "payload": payload})
        try:
            await asyncio.to_thread(
                requests.post, f"{NODE_SERVER_URL}/api/telemetry/ingest", json=payload, timeout=0.5
            )
        except Exception:
            pass
