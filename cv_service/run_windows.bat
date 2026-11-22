@echo off
echo Starting VisionGuard Python FastAPI CV Service on http://0.0.0.0:8000 ...
call .venv\Scripts\activate.bat
uvicorn main:app --host 0.0.0.0 --port 8000 --workers 1
pause
