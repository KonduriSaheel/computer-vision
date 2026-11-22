@echo off
echo ============================================================
echo VisionGuard Python Computer Vision Service - Windows Setup
echo ============================================================

python --version >nul 2>&1
if errorlevel 1 (
    echo [ERROR] Python 3.10 or 3.11 is required and must be added to PATH.
    pause
    exit /b 1
)

if not exist ".venv" (
    echo Creating virtual environment in .venv...
    python -m venv .venv
)

call .venv\Scripts\activate.bat
python -m pip install --upgrade pip
pip install -r requirements.txt

echo Downloading lightweight YOLOv8n weights into cv_service\models\yolov8n.pt...
python -c "from ultralytics import YOLO; YOLO('models/yolov8n.pt')"

echo.
echo Setup complete! Run run_windows.bat to start the CV service on port 8000.
pause
