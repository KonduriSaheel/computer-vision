from abc import ABC, abstractmethod
from collections import deque
from dataclasses import dataclass
import queue
import threading
import time
from typing import Optional, Tuple
import cv2
import numpy as np


@dataclass
class FramePacket:
    frame: np.ndarray
    captured_at: float
    frame_index: int
    width: int
    height: int
    brightness: float
    contrast: float


class CameraSource(ABC):
    """Common CameraSource interface for Module 1: Video Acquisition."""

    def __init__(self, camera_id: str, name: str, source_type: str, stream_url: Optional[str] = None):
        self.camera_id = camera_id
        self.name = name
        self.source_type = source_type
        self.stream_url = stream_url
        self.status = "DISCONNECTED"
        self.last_error: Optional[str] = None
        self.frame_queue: queue.Queue[FramePacket] = queue.Queue(maxsize=2)
        self.frame_count = 0
        self.capture_fps = 0.0
        self.width = 0
        self.height = 0
        self.brightness = 0.0
        self.contrast = 0.0
        self._stop_event = threading.Event()
        self._thread: Optional[threading.Thread] = None
        self._cap: Optional[cv2.VideoCapture] = None
        self._ts_history: deque[float] = deque(maxlen=30)

    @abstractmethod
    def open_capture(self) -> cv2.VideoCapture:
        pass

    def start(self) -> None:
        if self._thread and self._thread.is_alive():
            return
        self._stop_event.clear()
        self.status = "CONNECTING"
        self._thread = threading.Thread(target=self._capture_loop, daemon=True)
        self._thread.start()

    def stop(self) -> None:
        self._stop_event.set()
        if self._thread:
            self._thread.join(timeout=2.0)
        if self._cap is not None:
            self._cap.release()
            self._cap = None
        self.status = "DISCONNECTED"

    def read_latest(self, timeout: float = 0.2) -> Optional[FramePacket]:
        try:
            return self.frame_queue.get(timeout=timeout)
        except queue.Empty:
            return None

    def _validate_and_measure(self, frame: np.ndarray) -> Tuple[bool, float, float]:
        if frame is None or frame.size == 0 or len(frame.shape) < 2:
            return False, 0.0, 0.0
        gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
        brightness = float(np.mean(gray))
        contrast = float(np.std(gray))
        return True, round(brightness, 2), round(contrast, 2)

    def _capture_loop(self) -> None:
        reconnect_attempts = 0
        while not self._stop_event.is_set():
            try:
                self.status = "CONNECTING" if reconnect_attempts == 0 else "RECONNECTING"
                self._cap = self.open_capture()
                if self._cap is None or not self._cap.isOpened():
                    raise RuntimeError(f"Unable to open {self.source_type} stream: {self.stream_url or 'default'}")

                self.status = "CONNECTED"
                self.last_error = None
                reconnect_attempts = 0

                while not self._stop_event.is_set():
                    ok, frame = self._cap.read()
                    if not ok or frame is None:
                        if self.source_type == "VIDEO_FILE":
                            # End of video file; loop or stop cleanly
                            self._cap.set(cv2.CAP_PROP_POS_FRAMES, 0)
                            ok, frame = self._cap.read()
                            if not ok:
                                raise RuntimeError("Reached end of video file.")
                        else:
                            raise RuntimeError("Frame read failed from camera stream.")

                    valid, brightness, contrast = self._validate_and_measure(frame)
                    if not valid:
                        continue

                    now = time.time()
                    self._ts_history.append(now)
                    if len(self._ts_history) >= 2:
                        span = self._ts_history[-1] - self._ts_history[0]
                        if span > 0:
                            self.capture_fps = round((len(self._ts_history) - 1) / span, 1)

                    h, w = frame.shape[:2]
                    self.width = w
                    self.height = h
                    self.brightness = brightness
                    self.contrast = contrast
                    self.frame_count += 1

                    packet = FramePacket(
                        frame=frame,
                        captured_at=now,
                        frame_index=self.frame_count,
                        width=w,
                        height=h,
                        brightness=brightness,
                        contrast=contrast,
                    )

                    # Bounded queue: drop stale frame to keep processing newest frame
                    if self.frame_queue.full():
                        try:
                            self.frame_queue.get_nowait()
                        except queue.Empty:
                            pass
                    self.frame_queue.put_nowait(packet)

                    if self.source_type == "VIDEO_FILE":
                        fps = self._cap.get(cv2.CAP_PROP_FPS) or 25.0
                        time.sleep(max(0.01, 1.0 / min(60.0, fps)))

            except Exception as exc:
                self.last_error = str(exc)
                reconnect_attempts += 1
                if self._cap is not None:
                    self._cap.release()
                    self._cap = None
                if reconnect_attempts > 10:
                    self.status = "ERROR"
                    break
                self.status = "RECONNECTING"
                time.sleep(min(5.0, 0.5 * reconnect_attempts))


class MobileCameraSource(CameraSource):
    def open_capture(self) -> cv2.VideoCapture:
        if not self.stream_url:
            raise ValueError("Mobile camera HTTP/MJPEG stream URL is required.")
        cap = cv2.VideoCapture(self.stream_url)
        cap.set(cv2.CAP_PROP_BUFFERSIZE, 1)
        return cap


class WebcamSource(CameraSource):
    def open_capture(self) -> cv2.VideoCapture:
        idx = 0
        if self.stream_url and self.stream_url.startswith("webcam://"):
            raw = self.stream_url.replace("webcam://", "").strip()
            if raw.isdigit():
                idx = int(raw)
        cap = cv2.VideoCapture(idx)
        cap.set(cv2.CAP_PROP_BUFFERSIZE, 1)
        return cap


class RTSPCameraSource(CameraSource):
    def open_capture(self) -> cv2.VideoCapture:
        if not self.stream_url:
            raise ValueError("RTSP URL is required.")
        cap = cv2.VideoCapture(self.stream_url, cv2.CAP_FFMPEG)
        cap.set(cv2.CAP_PROP_BUFFERSIZE, 1)
        return cap


class IPCameraSource(CameraSource):
    def open_capture(self) -> cv2.VideoCapture:
        if not self.stream_url:
            raise ValueError("IP camera HTTP/MJPEG URL is required.")
        cap = cv2.VideoCapture(self.stream_url)
        cap.set(cv2.CAP_PROP_BUFFERSIZE, 1)
        return cap


class VideoFileSource(CameraSource):
    def open_capture(self) -> cv2.VideoCapture:
        if not self.stream_url:
            raise ValueError("Video file path is required.")
        return cv2.VideoCapture(self.stream_url)


def create_camera_source(camera_id: str, name: str, source_type: str, stream_url: Optional[str]) -> CameraSource:
    mapping = {
        "MOBILE": MobileCameraSource,
        "WEBCAM": WebcamSource,
        "RTSP": RTSPCameraSource,
        "IP": IPCameraSource,
        "VIDEO_FILE": VideoFileSource,
    }
    cls = mapping.get(source_type)
    if not cls:
        raise ValueError(f"Unsupported camera source type: {source_type}")
    return cls(camera_id=camera_id, name=name, source_type=source_type, stream_url=stream_url)
