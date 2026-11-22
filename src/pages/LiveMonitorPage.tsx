import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  AlertTriangle,
  Camera,
  Maximize2,
  Pause,
  Play,
  Plus,
  Square,
  Trash2,
} from 'lucide-react';
import { ensureEdgeModelLoaded, measureFrameQuality, runEdgeObjectDetection } from '../cv/edgeDetector.ts';
import { MultiObjectTracker } from '../cv/tracker.ts';
import { BrowserZoneActivityEngine } from '../cv/zoneEngine.ts';
import { apiFetch } from '../lib/api.ts';
import type {
  CVConfigSettings,
  CameraRecord,
  DetectionBox,
  IncidentEventRecord,
  LiveTelemetryPayload,
  NormalizedPoint,
  ZoneRecord,
  ZoneType,
} from '../types/visionguard.ts';
import type { ActiveSessionConfig } from './ConnectionScreen.tsx';

interface LiveMonitorPageProps {
  activeSession: ActiveSessionConfig | null;
  cameras: CameraRecord[];
  config: CVConfigSettings;
  latestMobileFrame: {
    camera_id: string;
    frame_data_url: string;
    width: number;
    height: number;
    capture_fps: number;
    latency_ms: number;
  } | null;
  latestPythonTelemetry: LiveTelemetryPayload | null;
  recentAlerts: IncidentEventRecord[];
  onSelectSession: (session: ActiveSessionConfig) => void;
  onStopSession: () => void;
}

export const LiveMonitorPage: React.FC<LiveMonitorPageProps> = ({
  activeSession,
  cameras,
  config,
  latestMobileFrame,
  latestPythonTelemetry,
  recentAlerts,
  onSelectSession,
  onStopSession,
}) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const mobileCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const overlayCanvasRef = useRef<HTMLCanvasElement | null>(null);

  const trackerRef = useRef(new MultiObjectTracker());
  const zoneEngineRef = useRef(new BrowserZoneActivityEngine());
  const lastAlertSentRef = useRef<Map<string, number>>(new Map());
  const lastTelemetrySentRef = useRef<number>(0);

  const [running, setRunning] = useState(true);
  const [paused, setPaused] = useState(false);
  const [modelReady, setModelReady] = useState(false);
  const [modelLoading, setModelLoading] = useState(false);
  const [pipelineError, setPipelineError] = useState<string | null>(null);

  // Toggles
  const [showDetection, setShowDetection] = useState(true);
  const [showTracking, setShowTracking] = useState(true);
  const [showFaceLabels, setShowFaceLabels] = useState(true);
  const [showTrajectory, setShowTrajectory] = useState(true);
  const [showZones, setShowZones] = useState(true);
  const [showFpsHud, setShowFpsHud] = useState(true);

  // Zones & Polygon Editor
  const [zones, setZones] = useState<ZoneRecord[]>([]);
  const [drawingZone, setDrawingZone] = useState(false);
  const [draftPoints, setDraftPoints] = useState<NormalizedPoint[]>([]);
  const [showZoneModal, setShowZoneModal] = useState(false);
  const [zoneName, setZoneName] = useState('Restricted Zone A');
  const [zoneType, setZoneType] = useState<ZoneType>('RESTRICTED');
  const [dwellTimeSec, setDwellTimeSec] = useState(5);
  const [crowdThreshold, setCrowdThreshold] = useState(5);

  // Live stats
  const [liveTelemetry, setLiveTelemetry] = useState<LiveTelemetryPayload | null>(null);
  const frameCounterRef = useRef(0);

  const activeCamera = activeSession?.camera || null;

  const loadZones = useCallback(async () => {
    if (!activeCamera) {
      setZones([]);
      return;
    }
    try {
      const data = await apiFetch<{ zones: ZoneRecord[] }>(
        `/api/zones?camera_id=${encodeURIComponent(activeCamera.id)}`
      );
      setZones(data.zones);
    } catch {
      // ignore
    }
  }, [activeCamera]);

  useEffect(() => {
    loadZones();
    trackerRef.current.reset();
    zoneEngineRef.current.reset();
    frameCounterRef.current = 0;
  }, [loadZones, activeCamera?.id]);

  // Attach webcam or demo video element
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !activeSession) return;
    setPipelineError(null);

    if (activeSession.webcamStream) {
      video.srcObject = activeSession.webcamStream;
      video.play().catch(() => {});
    } else if (activeSession.demoVideoUrl) {
      video.srcObject = null;
      video.src = activeSession.demoVideoUrl;
      video.loop = true;
      video.muted = true;
      video.play().catch(() => {});
    } else {
      video.srcObject = null;
      video.removeAttribute('src');
    }
  }, [activeSession]);

  // Draw incoming Mobile WebSocket JPEG frames onto mobileCanvasRef
  useEffect(() => {
    if (
      !activeCamera ||
      activeCamera.source_type !== 'MOBILE' ||
      !latestMobileFrame ||
      latestMobileFrame.camera_id !== activeCamera.id ||
      paused ||
      !running
    ) {
      return;
    }
    const canvas = mobileCanvasRef.current;
    if (!canvas) return;
    const img = new Image();
    img.onload = () => {
      canvas.width = img.naturalWidth || 640;
      canvas.height = img.naturalHeight || 480;
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      }
    };
    img.src = latestMobileFrame.frame_data_url;
  }, [latestMobileFrame, activeCamera, paused, running]);

  // Load real Edge Neural Network when active camera relies on browser pipeline
  useEffect(() => {
    if (!activeSession || !config.browser_edge_cv_enabled) return;
    let cancelled = false;
    setModelLoading(true);
    ensureEdgeModelLoaded()
      .then(() => {
        if (!cancelled) {
          setModelReady(true);
          setModelLoading(false);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setModelLoading(false);
          setPipelineError(err instanceof Error ? err.message : 'Unable to load detection model.');
        }
      });
    return () => {
      cancelled = true;
    };
  }, [activeSession, config.browser_edge_cv_enabled]);

  // Real-time detection + tracking + zone + event loop
  useEffect(() => {
    if (!activeSession || !running || paused) return;

    // If Python CV Service is actively streaming telemetry for this camera, prefer Python stream
    if (
      latestPythonTelemetry &&
      latestPythonTelemetry.camera_id === activeSession.camera.id &&
      Date.now() - new Date(latestPythonTelemetry.timestamp).getTime() < 2500
    ) {
      setLiveTelemetry(latestPythonTelemetry);
      return;
    }

    if (!modelReady) return;

    let stopped = false;
    let timerId: number | null = null;
    const snapCanvas = document.createElement('canvas');

    const step = async () => {
      if (stopped) return;
      const tStart = performance.now();
      const cam = activeSession.camera;
      let sourceEl: HTMLVideoElement | HTMLCanvasElement | null = null;
      let width = 0;
      let height = 0;

      if (cam.source_type === 'WEBCAM' || cam.source_type === 'VIDEO_FILE') {
        const v = videoRef.current;
        if (v && v.readyState >= 2 && v.videoWidth > 0 && !v.paused) {
          sourceEl = v;
          width = v.videoWidth;
          height = v.videoHeight;
        }
      } else if (cam.source_type === 'MOBILE') {
        const mc = mobileCanvasRef.current;
        if (mc && mc.width > 0 && mc.height > 0) {
          sourceEl = mc;
          width = mc.width;
          height = mc.height;
        }
      }

      if (sourceEl && width > 0 && height > 0) {
        try {
          const { detections: rawDets, inferenceMs } = await runEdgeObjectDetection(
            sourceEl,
            config.yolo_confidence
          );
          const tracked = trackerRef.current.update(rawDets, width, height);
          const detectionBoxes: DetectionBox[] = tracked.map((t) => ({
            ...t,
            identity: null,
            zone_flags: [],
          }));

          const { events: candidateEvents, crowdLevel } = zoneEngineRef.current.analyze(
            cam.id,
            cam.name,
            detectionBoxes,
            zones,
            config.crowd_normal_max,
            config.crowd_elevated_max
          );

          // Capture snapshot for quality measurement and HIGH/CRITICAL/MEDIUM event evidence
          snapCanvas.width = Math.min(640, width);
          snapCanvas.height = Math.round((height / width) * snapCanvas.width) || 360;
          const sctx = snapCanvas.getContext('2d');
          let snapshotUrl: string | null = null;
          let quality = { brightness: 128, contrast: 45 };
          if (sctx) {
            sctx.drawImage(sourceEl, 0, 0, snapCanvas.width, snapCanvas.height);
            quality = measureFrameQuality(snapCanvas);
            if (candidateEvents.length > 0) {
              // Burn bounding boxes & zones into evidence snapshot
              drawOverlayOnContext(sctx, snapCanvas.width, snapCanvas.height, detectionBoxes, zones, {
                showDetection,
                showTracking,
                showFaceLabels,
                showTrajectory,
                showZones,
              });
              snapshotUrl = snapCanvas.toDataURL('image/jpeg', 0.85);
            }
          }

          // Dispatch deduplicated events to Node Event Engine
          const nowMs = Date.now();
          for (const cand of candidateEvents) {
            const cooldownKey = `${cand.event_type}:${cand.camera_id}:${cand.track_id ?? 'none'}`;
            const lastAt = lastAlertSentRef.current.get(cooldownKey) || 0;
            if (nowMs - lastAt >= config.event_cooldown_sec * 1000) {
              lastAlertSentRef.current.set(cooldownKey, nowMs);
              apiFetch('/api/events/ingest', {
                method: 'POST',
                body: JSON.stringify({
                  ...cand,
                  snapshot_data_url: snapshotUrl,
                  width: snapCanvas.width,
                  height: snapCanvas.height,
                }),
              }).catch(() => {});
            }
          }

          frameCounterRef.current += 1;
          const procMs = Math.max(1, performance.now() - tStart);
          const infFps = Number((1000 / Math.max(1, inferenceMs)).toFixed(1));
          const procFps = Number((1000 / procMs).toFixed(1));

          const counts: Record<string, number> = {};
          for (const d of detectionBoxes) {
            counts[d.class_name] = (counts[d.class_name] || 0) + 1;
          }

          const payload: LiveTelemetryPayload = {
            camera_id: cam.id,
            camera_name: cam.name,
            source_type: cam.source_type,
            status: 'CONNECTED',
            engine_label: 'Browser Edge CV (TF.js COCO-SSD + IoU Tracker)',
            timestamp: new Date().toISOString(),
            capture_fps:
              cam.source_type === 'MOBILE' && latestMobileFrame
                ? latestMobileFrame.capture_fps
                : procFps,
            processing_fps: procFps,
            inference_fps: infFps,
            latency_ms:
              cam.source_type === 'MOBILE' && latestMobileFrame
                ? latestMobileFrame.latency_ms
                : Math.round(procMs),
            frame_count: frameCounterRef.current,
            resolution_width: width,
            resolution_height: height,
            brightness: quality.brightness,
            contrast: quality.contrast,
            detections: detectionBoxes,
            object_counts: counts,
            people_count: counts.person || 0,
            active_tracks: detectionBoxes.length,
            crowd_level: crowdLevel,
          };

          setLiveTelemetry(payload);

          if (nowMs - lastTelemetrySentRef.current >= 400) {
            lastTelemetrySentRef.current = nowMs;
            apiFetch('/api/telemetry/ingest', {
              method: 'POST',
              body: JSON.stringify(payload),
            }).catch(() => {});
          }
        } catch (err) {
          setPipelineError(err instanceof Error ? err.message : 'Inference loop error.');
        }
      }

      if (!stopped) {
        timerId = window.setTimeout(step, Math.max(40, config.inference_interval_ms));
      }
    };

    timerId = window.setTimeout(step, 80);
    return () => {
      stopped = true;
      if (timerId !== null) window.clearTimeout(timerId);
    };
  }, [
    activeSession,
    running,
    paused,
    modelReady,
    zones,
    config,
    latestMobileFrame,
    latestPythonTelemetry,
    showDetection,
    showTracking,
    showFaceLabels,
    showTrajectory,
    showZones,
  ]);

  // Render overlay canvas (boxes, IDs, trajectories, polygons)
  useEffect(() => {
    const canvas = overlayCanvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const w = Math.max(320, Math.round(rect.width));
    const h = Math.max(180, Math.round(rect.height));
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, w, h);

    drawOverlayOnContext(ctx, w, h, liveTelemetry?.detections || [], zones, {
      showDetection,
      showTracking,
      showFaceLabels,
      showTrajectory,
      showZones,
    });

    // Draw draft polygon points while editing
    if (drawingZone && draftPoints.length > 0) {
      ctx.save();
      ctx.strokeStyle = '#38bdf8';
      ctx.lineWidth = 2;
      ctx.beginPath();
      draftPoints.forEach((pt, idx) => {
        const px = pt.x * w;
        const py = pt.y * h;
        if (idx === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      });
      ctx.stroke();

      draftPoints.forEach((pt, idx) => {
        ctx.fillStyle = idx === 0 ? '#22c55e' : '#38bdf8';
        ctx.beginPath();
        ctx.arc(pt.x * w, pt.y * h, 5, 0, Math.PI * 2);
        ctx.fill();
      });
      ctx.restore();
    }
  }, [
    liveTelemetry,
    zones,
    drawingZone,
    draftPoints,
    showDetection,
    showTracking,
    showFaceLabels,
    showTrajectory,
    showZones,
  ]);

  const handleCanvasClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!drawingZone || !overlayCanvasRef.current) return;
    const rect = overlayCanvasRef.current.getBoundingClientRect();
    const nx = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    const ny = Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height));
    setDraftPoints((pts) => [...pts, { x: Number(nx.toFixed(4)), y: Number(ny.toFixed(4)) }]);
  };

  const handleSaveZone = async () => {
    if (!activeCamera || draftPoints.length < 3) return;
    await apiFetch('/api/zones', {
      method: 'POST',
      body: JSON.stringify({
        camera_id: activeCamera.id,
        name: zoneName.trim() || 'Restricted Zone',
        zone_type: zoneType,
        polygon: draftPoints,
        dwell_time_sec: dwellTimeSec,
        crowd_threshold: crowdThreshold,
      }),
    });
    setDrawingZone(false);
    setDraftPoints([]);
    setShowZoneModal(false);
    await loadZones();
  };

  const handleTakeSnapshot = () => {
    const cam = activeCamera;
    if (!cam) return;
    const sourceEl =
      cam.source_type === 'MOBILE' ? mobileCanvasRef.current : videoRef.current;
    if (!sourceEl) return;
    const w = sourceEl instanceof HTMLVideoElement ? sourceEl.videoWidth : sourceEl.width;
    const h = sourceEl instanceof HTMLVideoElement ? sourceEl.videoHeight : sourceEl.height;
    if (!w || !h) return;

    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    const ctx = c.getContext('2d');
    if (!ctx) return;
    ctx.drawImage(sourceEl, 0, 0, w, h);
    drawOverlayOnContext(ctx, w, h, liveTelemetry?.detections || [], zones, {
      showDetection,
      showTracking,
      showFaceLabels,
      showTrajectory,
      showZones,
    });
    const dataUrl = c.toDataURL('image/jpeg', 0.9);
    apiFetch('/api/events/ingest', {
      method: 'POST',
      body: JSON.stringify({
        event_type: 'OBJECT_DETECTED',
        severity: 'LOW',
        camera_id: cam.id,
        camera_name: cam.name,
        description: `Manual operator snapshot captured on ${cam.name}`,
        reason: `Operator triggered manual frame snapshot (${liveTelemetry?.people_count ?? 0} people, ${liveTelemetry?.active_tracks ?? 0} tracks).`,
        snapshot_data_url: dataUrl,
        width: w,
        height: h,
      }),
    }).catch(() => {});
  };

  const handleFullscreen = () => {
    if (!containerRef.current) return;
    if (document.fullscreenElement) {
      document.exitFullscreen().catch(() => {});
    } else {
      containerRef.current.requestFullscreen().catch(() => {});
    }
  };

  const handlePlayPause = () => {
    const nextPaused = !paused;
    setPaused(nextPaused);
    const v = videoRef.current;
    if (v && activeCamera?.source_type === 'VIDEO_FILE') {
      if (nextPaused) v.pause();
      else v.play().catch(() => {});
    }
  };

  return (
    <div ref={containerRef} className="p-5 space-y-4 bg-[#080d1a] min-h-full">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800 pb-3">
        <div>
          <h1 className="font-display text-lg font-semibold text-slate-100">Live Monitor</h1>
          <div className="text-xs text-slate-400">
            {activeCamera
              ? `${activeCamera.name} · ${activeCamera.source_type} · ${liveTelemetry?.engine_label || 'Awaiting frames'}`
              : 'No active camera stream selected'}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => {
              setRunning(true);
              setPaused(false);
              if (videoRef.current && activeCamera?.source_type === 'VIDEO_FILE') {
                videoRef.current.play().catch(() => {});
              }
            }}
            disabled={!activeCamera}
            className="px-3 py-1.5 rounded bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 text-xs font-semibold text-white flex items-center gap-1.5 whitespace-nowrap"
          >
            <Play className="w-3.5 h-3.5" />
            <span>START</span>
          </button>
          <button
            type="button"
            onClick={handlePlayPause}
            disabled={!activeCamera || !running}
            className="px-3 py-1.5 rounded bg-slate-800 hover:bg-slate-700 disabled:opacity-40 text-xs font-medium text-slate-200 flex items-center gap-1.5 whitespace-nowrap"
          >
            <Pause className="w-3.5 h-3.5" />
            <span>{paused ? 'RESUME' : 'PAUSE'}</span>
          </button>
          <button
            type="button"
            onClick={() => {
              setRunning(false);
              onStopSession();
            }}
            disabled={!activeCamera}
            className="px-3 py-1.5 rounded bg-red-600/90 hover:bg-red-500 disabled:opacity-40 text-xs font-semibold text-white flex items-center gap-1.5 whitespace-nowrap"
          >
            <Square className="w-3.5 h-3.5" />
            <span>STOP</span>
          </button>
          <button
            type="button"
            onClick={handleTakeSnapshot}
            disabled={!activeCamera}
            className="px-3 py-1.5 rounded border border-slate-700 bg-slate-900 hover:bg-slate-800 disabled:opacity-40 text-xs font-medium text-slate-200 flex items-center gap-1.5 whitespace-nowrap"
          >
            <Camera className="w-3.5 h-3.5" />
            <span>SNAPSHOT</span>
          </button>
          <button
            type="button"
            onClick={handleFullscreen}
            className="px-3 py-1.5 rounded border border-slate-700 bg-slate-900 hover:bg-slate-800 text-xs font-medium text-slate-200 flex items-center gap-1.5 whitespace-nowrap"
          >
            <Maximize2 className="w-3.5 h-3.5" />
            <span>FULLSCREEN</span>
          </button>
        </div>
      </div>

      {/* Overlay Toggles + Zone Editor Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-3 bg-[#0f172a] border border-slate-800 rounded-md px-3.5 py-2.5">
        <div className="flex flex-wrap items-center gap-2">
          {[
            { label: 'DETECTION', val: showDetection, set: setShowDetection },
            { label: 'TRACKING', val: showTracking, set: setShowTracking },
            { label: 'FACE RECOGNITION', val: showFaceLabels, set: setShowFaceLabels },
            { label: 'TRAJECTORY', val: showTrajectory, set: setShowTrajectory },
            { label: 'ZONES', val: showZones, set: setShowZones },
            { label: 'FPS', val: showFpsHud, set: setShowFpsHud },
          ].map((t) => (
            <button
              key={t.label}
              type="button"
              onClick={() => t.set(!t.val)}
              className={`px-2.5 py-1 rounded text-[11px] font-medium border transition-colors whitespace-nowrap ${
                t.val
                  ? 'bg-blue-600/20 border-blue-500/50 text-blue-300'
                  : 'bg-slate-900 border-slate-800 text-slate-400 hover:text-slate-200'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-2">
          {!drawingZone ? (
            <button
              type="button"
              disabled={!activeCamera}
              onClick={() => {
                setDrawingZone(true);
                setDraftPoints([]);
              }}
              className="px-3 py-1.5 rounded bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 text-xs font-semibold text-white flex items-center gap-1.5 whitespace-nowrap"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>CREATE ZONE</span>
            </button>
          ) : (
            <>
              <span className="text-xs text-sky-300">Click points on video ({draftPoints.length} pts)</span>
              <button
                type="button"
                disabled={draftPoints.length < 3}
                onClick={() => setShowZoneModal(true)}
                className="px-3 py-1 rounded bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 text-xs font-semibold text-white whitespace-nowrap"
              >
                Close Polygon
              </button>
              <button
                type="button"
                onClick={() => {
                  setDrawingZone(false);
                  setDraftPoints([]);
                }}
                className="px-2.5 py-1 rounded bg-slate-800 text-xs text-slate-300 whitespace-nowrap"
              >
                Cancel
              </button>
            </>
          )}
        </div>
      </div>

      {pipelineError && (
        <div className="p-3 rounded-md bg-amber-950/40 border border-amber-800/60 text-amber-200 text-xs flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 shrink-0" />
          <span>{pipelineError}</span>
        </div>
      )}

      <div className="grid grid-cols-1 xl:grid-cols-12 gap-5">
        {/* Main Video Viewport */}
        <div className="xl:col-span-9 bg-[#0f172a] border border-slate-800 rounded-lg overflow-hidden">
          <div className="relative aspect-video bg-black flex items-center justify-center">
            <video
              ref={videoRef}
              playsInline
              muted
              className={`w-full h-full object-contain ${
                activeCamera?.source_type === 'MOBILE' || !activeCamera ? 'hidden' : 'block'
              }`}
            />
            <canvas
              ref={mobileCanvasRef}
              className={`w-full h-full object-contain ${
                activeCamera?.source_type === 'MOBILE' ? 'block' : 'hidden'
              }`}
            />
            <canvas
              ref={overlayCanvasRef}
              onClick={handleCanvasClick}
              className={`absolute inset-0 w-full h-full ${drawingZone ? 'cursor-crosshair' : 'pointer-events-none'}`}
            />

            {!activeCamera && (
              <div className="text-center p-6 space-y-2">
                <Camera className="w-10 h-10 text-slate-600 mx-auto" />
                <div className="text-sm font-medium text-slate-300">No Active Video Source</div>
                <p className="text-xs text-slate-500 max-w-md">
                  Connect a Mobile Camera, Webcam, IP/RTSP stream, or upload a Demo Mode video from Connection Setup.
                </p>
              </div>
            )}

            {activeCamera?.source_type === 'MOBILE' && !latestMobileFrame && (
              <div className="absolute inset-0 flex flex-col items-center justify-center bg-slate-950/85 text-center p-4">
                <div className="text-sm font-medium text-slate-200">
                  Waiting for live mobile camera frames from {activeCamera.name}...
                </div>
                <p className="text-xs text-slate-400 mt-1">
                  Open the Mobile Broadcaster link on your phone and tap Start Mobile Stream.
                </p>
              </div>
            )}

            {modelLoading && (
              <div className="absolute top-3 left-3 bg-slate-950/85 border border-slate-700 px-3 py-1.5 rounded text-xs text-blue-300">
                Loading neural network detection weights...
              </div>
            )}

            {showFpsHud && liveTelemetry && (
              <div className="absolute top-3 right-3 bg-slate-950/85 border border-slate-800 rounded px-3 py-1.5 font-mono text-[11px] tabular-nums text-slate-200 flex items-center gap-3">
                <span>CAP {liveTelemetry.capture_fps} FPS</span>
                <span>INF {liveTelemetry.inference_fps} FPS</span>
                <span>{liveTelemetry.latency_ms} ms</span>
                <span>{liveTelemetry.resolution_width}x{liveTelemetry.resolution_height}</span>
              </div>
            )}
          </div>
        </div>

        {/* Right Telemetry & Active Alerts Panel */}
        <div className="xl:col-span-3 space-y-4">
          <div className="bg-[#0f172a] border border-slate-800 rounded-lg p-4 space-y-3">
            <h2 className="font-display text-xs font-semibold text-slate-200">Live Telemetry</h2>
            <div className="grid grid-cols-2 gap-2.5 text-xs">
              <div className="bg-slate-950 border border-slate-800/80 rounded p-2.5">
                <div className="text-slate-500">People</div>
                <div className="font-mono text-lg font-semibold tabular-nums text-slate-100">
                  {liveTelemetry?.people_count ?? 0}
                </div>
              </div>
              <div className="bg-slate-950 border border-slate-800/80 rounded p-2.5">
                <div className="text-slate-500">Active Tracks</div>
                <div className="font-mono text-lg font-semibold tabular-nums text-slate-100">
                  {liveTelemetry?.active_tracks ?? 0}
                </div>
              </div>
              <div className="bg-slate-950 border border-slate-800/80 rounded p-2.5">
                <div className="text-slate-500">Crowd Level</div>
                <div
                  className={`font-mono text-xs font-semibold mt-1 ${
                    liveTelemetry?.crowd_level === 'HIGH'
                      ? 'text-red-400'
                      : liveTelemetry?.crowd_level === 'ELEVATED'
                        ? 'text-amber-400'
                        : 'text-emerald-400'
                  }`}
                >
                  {liveTelemetry?.crowd_level || 'NORMAL'}
                </div>
              </div>
              <div className="bg-slate-950 border border-slate-800/80 rounded p-2.5">
                <div className="text-slate-500">Brightness / Contrast</div>
                <div className="font-mono text-xs tabular-nums text-slate-200 mt-1">
                  {liveTelemetry ? `${liveTelemetry.brightness} / ${liveTelemetry.contrast}` : '0 / 0'}
                </div>
              </div>
            </div>

            {zones.length > 0 && (
              <div className="pt-2 border-t border-slate-800 space-y-1.5">
                <div className="text-[11px] font-medium text-slate-400">Active Camera Zones ({zones.length})</div>
                {zones.map((z) => (
                  <div key={z.id} className="flex items-center justify-between text-xs bg-slate-950 px-2.5 py-1.5 rounded border border-slate-800/70">
                    <span className="truncate text-slate-200">
                      {z.name} <span className="text-slate-500">({z.zone_type})</span>
                    </span>
                    <button
                      type="button"
                      onClick={async () => {
                        await apiFetch(`/api/zones/${z.id}`, { method: 'DELETE' });
                        await loadZones();
                      }}
                      className="text-slate-500 hover:text-red-400"
                      title="Delete zone"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="bg-[#0f172a] border border-slate-800 rounded-lg p-4 space-y-2.5">
            <h2 className="font-display text-xs font-semibold text-slate-200">Live Alert Stream</h2>
            {recentAlerts.length === 0 ? (
              <div className="text-xs text-slate-500 py-3">No alerts triggered in current session.</div>
            ) : (
              <div className="space-y-2 max-h-64 overflow-y-auto">
                {recentAlerts.slice(0, 8).map((ev) => (
                  <div key={ev.id} className="p-2.5 rounded bg-slate-950 border border-slate-800 text-xs space-y-1">
                    <div className="flex items-center justify-between gap-2">
                      <span
                        className={`font-semibold ${
                          ev.severity === 'CRITICAL' || ev.severity === 'HIGH'
                            ? 'text-red-400'
                            : ev.severity === 'MEDIUM'
                              ? 'text-amber-400'
                              : 'text-slate-300'
                        }`}
                      >
                        {ev.severity} · {ev.event_type}
                      </span>
                      <span className="font-mono text-[10px] text-slate-500 tabular-nums">
                        {new Date(ev.created_at).toLocaleTimeString()}
                      </span>
                    </div>
                    <div className="text-slate-300">{ev.reason || ev.description}</div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {cameras.length > 0 && (
            <div className="bg-[#0f172a] border border-slate-800 rounded-lg p-4 space-y-2">
              <div className="text-xs font-semibold text-slate-200">Switch Camera</div>
              <select
                value={activeCamera?.id || ''}
                onChange={(e) => {
                  const found = cameras.find((c) => c.id === e.target.value);
                  if (found) {
                    onSelectSession({
                      camera: found,
                      demoVideoUrl:
                        found.source_type === 'VIDEO_FILE' && found.stream_url ? found.stream_url : undefined,
                    });
                  }
                }}
                className="w-full bg-slate-950 border border-slate-800 rounded px-2.5 py-1.5 text-xs text-slate-200"
              >
                <option value="">Select camera...</option>
                {cameras.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name} ({c.source_type})
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>
      </div>

      {/* Zone Configuration Modal */}
      {showZoneModal && (
        <div className="fixed inset-0 bg-black/75 flex items-center justify-center p-4 z-50">
          <div className="bg-[#0f172a] border border-slate-700 rounded-lg p-5 w-full max-w-md space-y-4">
            <h3 className="font-display text-base font-semibold text-slate-100">Configure Danger Zone</h3>
            <div className="space-y-3 text-xs">
              <div>
                <label className="block text-slate-300 mb-1">Zone Name</label>
                <input
                  type="text"
                  value={zoneName}
                  onChange={(e) => setZoneName(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded px-3 py-2 text-slate-100"
                />
              </div>
              <div>
                <label className="block text-slate-300 mb-1">Zone Type</label>
                <select
                  value={zoneType}
                  onChange={(e) => setZoneType(e.target.value as ZoneType)}
                  className="w-full bg-slate-950 border border-slate-800 rounded px-3 py-2 text-slate-100"
                >
                  <option value="RESTRICTED">RESTRICTED (Triggers Danger-Zone Intrusion)</option>
                  <option value="MONITORING">MONITORING (Loitering &amp; Crowding)</option>
                  <option value="SAFE">SAFE</option>
                </select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-slate-300 mb-1">Dwell Time (sec)</label>
                  <input
                    type="number"
                    min={1}
                    max={300}
                    value={dwellTimeSec}
                    onChange={(e) => setDwellTimeSec(Number(e.target.value))}
                    className="w-full bg-slate-950 border border-slate-800 rounded px-3 py-2 text-slate-100 font-mono"
                  />
                </div>
                <div>
                  <label className="block text-slate-300 mb-1">Crowd Threshold</label>
                  <input
                    type="number"
                    min={1}
                    max={100}
                    value={crowdThreshold}
                    onChange={(e) => setCrowdThreshold(Number(e.target.value))}
                    className="w-full bg-slate-950 border border-slate-800 rounded px-3 py-2 text-slate-100 font-mono"
                  />
                </div>
              </div>
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setShowZoneModal(false)}
                className="px-3.5 py-2 rounded bg-slate-800 text-xs text-slate-200"
              >
                Back
              </button>
              <button
                type="button"
                onClick={handleSaveZone}
                className="px-4 py-2 rounded bg-blue-600 hover:bg-blue-500 text-xs font-semibold text-white"
              >
                Save Zone
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

function drawOverlayOnContext(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  detections: DetectionBox[],
  zones: ZoneRecord[],
  opts: {
    showDetection: boolean;
    showTracking: boolean;
    showFaceLabels: boolean;
    showTrajectory: boolean;
    showZones: boolean;
  }
) {
  // 1. Zones
  if (opts.showZones) {
    for (const z of zones) {
      if (!z.enabled) continue;
      let pts: NormalizedPoint[] = [];
      try {
        pts = z.polygon || (JSON.parse(z.polygon_json) as NormalizedPoint[]);
      } catch {
        continue;
      }
      if (pts.length < 3) continue;
      const stroke =
        z.zone_type === 'RESTRICTED' ? '#ef4444' : z.zone_type === 'MONITORING' ? '#f59e0b' : '#10b981';
      const fill =
        z.zone_type === 'RESTRICTED'
          ? 'rgba(239, 68, 68, 0.16)'
          : z.zone_type === 'MONITORING'
            ? 'rgba(245, 158, 11, 0.14)'
            : 'rgba(16, 185, 129, 0.12)';
      ctx.save();
      ctx.beginPath();
      pts.forEach((p, idx) => {
        if (idx === 0) ctx.moveTo(p.x * w, p.y * h);
        else ctx.lineTo(p.x * w, p.y * h);
      });
      ctx.closePath();
      ctx.fillStyle = fill;
      ctx.fill();
      ctx.strokeStyle = stroke;
      ctx.lineWidth = 2;
      ctx.stroke();

      ctx.font = '600 11px "IBM Plex Mono", monospace';
      ctx.fillStyle = stroke;
      ctx.fillText(`${z.name} [${z.zone_type}]`, pts[0].x * w + 4, Math.max(14, pts[0].y * h - 6));
      ctx.restore();
    }
  }

  // 2. Trajectories
  if (opts.showTrajectory) {
    for (const det of detections) {
      if (!det.trajectory || det.trajectory.length < 2) continue;
      ctx.save();
      ctx.strokeStyle = '#38bdf8';
      ctx.lineWidth = 1.75;
      ctx.beginPath();
      det.trajectory.forEach(([tx, ty], i) => {
        if (i === 0) ctx.moveTo(tx * w, ty * h);
        else ctx.lineTo(tx * w, ty * h);
      });
      ctx.stroke();
      ctx.restore();
    }
  }

  // 3. Bounding Boxes + Labels
  if (opts.showDetection) {
    for (const det of detections) {
      const [x1, y1, x2, y2] = det.bbox;
      const bx = x1 * w;
      const by = y1 * h;
      const bw = (x2 - x1) * w;
      const bh = (y2 - y1) * h;

      const inRestricted = (det.zone_flags || []).length > 0;
      const color = inRestricted ? '#ef4444' : det.class_name === 'person' ? '#3b82f6' : '#8b5cf6';

      ctx.save();
      ctx.strokeStyle = color;
      ctx.lineWidth = 2;
      ctx.strokeRect(bx, by, bw, bh);

      const parts = [det.class_name.toUpperCase(), det.confidence.toFixed(2)];
      if (opts.showTracking) {
        parts.push(`ID ${String(det.track_id).padStart(2, '0')}`);
      }
      if (opts.showFaceLabels && det.identity) {
        parts.push(`${det.identity.label} (${det.identity.similarity.toFixed(2)})`);
      }
      const label = parts.join(' | ');
      ctx.font = '600 11px "IBM Plex Mono", monospace';
      const textWidth = ctx.measureText(label).width;
      const ly = Math.max(18, by);
      ctx.fillStyle = color;
      ctx.fillRect(bx, ly - 18, textWidth + 10, 18);
      ctx.fillStyle = '#ffffff';
      ctx.fillText(label, bx + 5, ly - 5);

      // Center point dot
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(det.center[0] * w, det.center[1] * h, 3, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  }
}
