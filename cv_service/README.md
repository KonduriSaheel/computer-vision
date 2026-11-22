# VisionGuard Python Computer Vision Service

This is the separately deployable Python FastAPI Computer Vision microservice for VisionGuard.
It runs **Ultralytics YOLOv8n**, **ByteTrack**, **OpenCV VideoCapture & Chessboard Calibration**, and **InsightFace ArcFace** face recognition.

## Local Windows Setup (Intel i5, 8–16 GB RAM)

1. Install **Python 3.10 or 3.11** (64-bit) with "Add Python to PATH" checked.
2. Open Command Prompt inside `cv_service\`:
   ```bat
   setup_windows.bat
   ```
3. Start the CV service:
   ```bat
   run_windows.bat
   ```
4. The service starts on `http://localhost:8000`.
   - Health probe: `GET http://localhost:8000/health`
   - WebSocket stream: `ws://localhost:8000/ws/live`

## Connecting to VisionGuard Web App

- If running Node.js locally (`npm run dev`), VisionGuard automatically connects to `CV_SERVICE_URL=http://localhost:8000`.
- If running VisionGuard in Google AI Studio cloud preview, expose your local port 8000 securely (e.g., via `ngrok http 8000` or Cloudflare Tunnel) and set the **CV Service URL** inside VisionGuard's **System Health** settings panel.
- When the external Python CV Service is offline, VisionGuard's browser **Edge CV Engine** (TensorFlow.js COCO-SSD + IoU Multi-Object Tracker + Point-in-Polygon Zone Engine) processes live webcam, mobile WebSocket camera, and uploaded demo videos without fabricating detections.
