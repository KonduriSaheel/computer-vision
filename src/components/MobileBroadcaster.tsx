import React, { useEffect, useRef, useState } from 'react';
import { Camera, RefreshCw, StopCircle, Video } from 'lucide-react';

export const MobileBroadcaster: React.FC = () => {
  const params = new URLSearchParams(window.location.search);
  const cameraId = params.get('cam') || '';
  const token = params.get('token') || '';
  const cameraName = params.get('name') || 'Mobile Phone Camera';

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const timerRef = useRef<number | null>(null);

  const [facingMode, setFacingMode] = useState<'environment' | 'user'>('environment');
  const [streaming, setStreaming] = useState(false);
  const [statusMsg, setStatusMsg] = useState('Ready to stream camera feed to VisionGuard.');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [framesSent, setFramesSent] = useState(0);
  const [targetFps, setTargetFps] = useState(10);

  const stopBroadcast = () => {
    if (timerRef.current) {
      window.clearInterval(timerRef.current);
      timerRef.current = null;
    }
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    setStreaming(false);
    setStatusMsg('Broadcast stopped.');
  };

  const startBroadcast = async () => {
    setErrorMsg(null);
    if (!cameraId || !token) {
      setErrorMsg('Missing camera ID or ingest token in URL.');
      return;
    }

    try {
      setStatusMsg('Requesting mobile camera permission...');
      const mediaStream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode,
          width: { ideal: 640 },
          height: { ideal: 480 },
        },
        audio: false,
      });
      streamRef.current = mediaStream;
      if (videoRef.current) {
        videoRef.current.srcObject = mediaStream;
        await videoRef.current.play();
      }

      const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const wsUrl = `${proto}//${window.location.host}/ws/ingest/${encodeURIComponent(cameraId)}?token=${encodeURIComponent(token)}`;
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        setStreaming(true);
        setStatusMsg('Streaming live video frames to VisionGuard.');
        const intervalMs = Math.max(50, Math.round(1000 / targetFps));
        timerRef.current = window.setInterval(() => {
          const video = videoRef.current;
          const canvas = canvasRef.current;
          if (!video || !canvas || video.videoWidth === 0 || ws.readyState !== WebSocket.OPEN) {
            return;
          }
          if (ws.bufferedAmount > 256 * 1024) {
            return; // Drop stale frame to keep latency low
          }
          const w = 640;
          const h = Math.round((video.videoHeight / video.videoWidth) * w) || 480;
          canvas.width = w;
          canvas.height = h;
          const ctx = canvas.getContext('2d');
          if (!ctx) return;
          ctx.drawImage(video, 0, 0, w, h);
          const dataUrl = canvas.toDataURL('image/jpeg', 0.68);
          ws.send(
            JSON.stringify({
              frame_data_url: dataUrl,
              width: w,
              height: h,
              client_ts: Date.now(),
            })
          );
          setFramesSent((n) => n + 1);
        }, intervalMs);
      };

      ws.onerror = () => {
        setErrorMsg('WebSocket connection error while streaming to VisionGuard.');
      };

      ws.onclose = () => {
        setStreaming(false);
        setStatusMsg('Connection closed. Tap Start Stream to reconnect.');
      };
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Unable to access mobile camera.');
      stopBroadcast();
    }
  };

  useEffect(() => {
    return () => {
      stopBroadcast();
    };
  }, []);

  return (
    <div className="min-h-screen bg-[#080d1a] text-slate-100 flex flex-col p-4 max-w-lg mx-auto">
      <header className="flex items-center justify-between py-3 border-b border-slate-800">
        <div>
          <div className="font-display font-bold text-base text-slate-100">VisionGuard Mobile Sender</div>
          <div className="text-xs text-slate-400">{cameraName}</div>
        </div>
        <span className="font-mono text-xs tabular-nums text-slate-400">{framesSent} frames</span>
      </header>

      <div className="mt-4 bg-[#0f172a] border border-slate-800 rounded-lg overflow-hidden aspect-[4/3] flex items-center justify-center relative">
        <video ref={videoRef} playsInline muted className="w-full h-full object-cover" />
        {!streaming && (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-slate-950/75 text-center p-4">
            <Camera className="w-10 h-10 text-blue-400 mb-2" />
            <p className="text-sm text-slate-300">Camera preview starts when streaming begins</p>
          </div>
        )}
      </div>
      <canvas ref={canvasRef} className="hidden" />

      <div className="mt-4 bg-[#0f172a] border border-slate-800 rounded-lg p-4 space-y-3">
        <div className="text-xs text-slate-300">{statusMsg}</div>
        {errorMsg && <div className="text-xs text-red-400 bg-red-950/40 border border-red-900/60 p-2.5 rounded">{errorMsg}</div>}

        <div className="flex items-center justify-between gap-3">
          <label className="text-xs text-slate-400">Frame Rate</label>
          <select
            value={targetFps}
            disabled={streaming}
            onChange={(e) => setTargetFps(Number(e.target.value))}
            className="bg-slate-900 border border-slate-700 rounded px-2.5 py-1.5 text-xs text-slate-200"
          >
            <option value={6}>6 FPS (Low Bandwidth)</option>
            <option value={10}>10 FPS (Balanced)</option>
            <option value={15}>15 FPS (High Smoothness)</option>
          </select>
        </div>

        <div className="flex items-center gap-2 pt-1">
          {!streaming ? (
            <button
              type="button"
              onClick={startBroadcast}
              className="flex-1 flex items-center justify-center gap-2 py-3 px-4 bg-blue-600 hover:bg-blue-500 text-white text-sm font-semibold rounded-md transition-colors"
            >
              <Video className="w-4 h-4" />
              <span>Start Mobile Stream</span>
            </button>
          ) : (
            <button
              type="button"
              onClick={stopBroadcast}
              className="flex-1 flex items-center justify-center gap-2 py-3 px-4 bg-red-600 hover:bg-red-500 text-white text-sm font-semibold rounded-md transition-colors"
            >
              <StopCircle className="w-4 h-4" />
              <span>Stop Stream</span>
            </button>
          )}
          <button
            type="button"
            disabled={streaming}
            onClick={() => setFacingMode((m) => (m === 'environment' ? 'user' : 'environment'))}
            className="py-3 px-3 bg-slate-800 hover:bg-slate-700 disabled:opacity-50 text-slate-200 rounded-md text-xs flex items-center gap-1.5"
          >
            <RefreshCw className="w-4 h-4" />
            <span>{facingMode === 'environment' ? 'Rear' : 'Front'}</span>
          </button>
        </div>
      </div>
    </div>
  );
};
