import React, { useState } from 'react';
import { Trash2 } from 'lucide-react';
import { apiFetch } from '../lib/api.ts';
import type {
  AppPage,
  CVConfigSettings,
  CameraRecord,
  LiveTelemetryPayload,
} from '../types/visionguard.ts';
import type { ActiveSessionConfig } from './ConnectionScreen.tsx';

interface CamerasPageProps {
  cameras: CameraRecord[];
  onRefresh: () => Promise<void>;
  onActivateSession: (session: ActiveSessionConfig) => void;
  onNavigate: (page: AppPage) => void;
}

export const CamerasPage: React.FC<CamerasPageProps> = ({
  cameras,
  onRefresh,
  onActivateSession,
  onNavigate,
}) => {
  const [error, setError] = useState<string | null>(null);

  const handleDelete = async (id: string) => {
    setError(null);
    try {
      await apiFetch(`/api/cameras/${id}`, { method: 'DELETE' });
      await onRefresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to delete camera.');
    }
  };

  const handleDisconnect = async (id: string) => {
    await apiFetch(`/api/cameras/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ status: 'DISCONNECTED', is_active: 0 }),
    });
    await onRefresh();
  };

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800 pb-4">
        <div>
          <h1 className="font-display text-xl font-semibold text-slate-100">
            Module 1 · Camera Acquisition Manager
          </h1>
          <p className="text-xs text-slate-400 mt-0.5">
            Unified CameraSource registry with live resolution, capture FPS, latency, brightness, and contrast
          </p>
        </div>
        <button
          type="button"
          onClick={() => onNavigate('connection')}
          className="px-4 py-2 rounded-md bg-blue-600 hover:bg-blue-500 text-xs font-semibold text-white whitespace-nowrap"
        >
          Add / Connect Camera
        </button>
      </div>

      {error && <div className="p-3 rounded bg-red-950/30 border border-red-800/60 text-xs text-red-300">{error}</div>}

      {cameras.length === 0 ? (
        <div className="bg-[#0f172a] border border-slate-800 rounded-lg p-8 text-center text-sm text-slate-400">
          No cameras registered yet. Open Connection Setup to register a Mobile Camera, Webcam, IP/RTSP stream, or Demo Video.
        </div>
      ) : (
        <div className="bg-[#0f172a] border border-slate-800 rounded-lg overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="border-b border-slate-800 text-slate-400">
                <th className="py-3 px-4 font-medium">Camera</th>
                <th className="py-3 px-3 font-medium">Source Type</th>
                <th className="py-3 px-3 font-medium">State</th>
                <th className="py-3 px-3 font-medium text-right">Resolution</th>
                <th className="py-3 px-3 font-medium text-right">Capture FPS</th>
                <th className="py-3 px-3 font-medium text-right">Latency</th>
                <th className="py-3 px-3 font-medium text-right">Brightness / Contrast</th>
                <th className="py-3 px-3 font-medium text-right">Frames</th>
                <th className="py-3 px-4 font-medium text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/80">
              {cameras.map((cam) => (
                <tr key={cam.id} className="hover:bg-slate-800/30">
                  <td className="py-3 px-4">
                    <div className="font-medium text-slate-100">{cam.name}</div>
                    <div className="font-mono text-[11px] text-slate-500 truncate max-w-[220px]">
                      {cam.stream_url || cam.id}
                    </div>
                  </td>
                  <td className="py-3 px-3 font-mono text-slate-300">{cam.source_type}</td>
                  <td className="py-3 px-3">
                    <span
                      className={`font-mono font-medium ${
                        cam.status === 'CONNECTED'
                          ? 'text-emerald-400'
                          : cam.status === 'ERROR'
                            ? 'text-red-400'
                            : cam.status === 'CONNECTING' || cam.status === 'RECONNECTING'
                              ? 'text-amber-400'
                              : 'text-slate-400'
                      }`}
                    >
                      {cam.status}
                    </span>
                  </td>
                  <td className="py-3 px-3 text-right font-mono tabular-nums text-slate-300">
                    {cam.resolution_width}x{cam.resolution_height}
                  </td>
                  <td className="py-3 px-3 text-right font-mono tabular-nums text-slate-300">
                    {cam.capture_fps} fps
                  </td>
                  <td className="py-3 px-3 text-right font-mono tabular-nums text-slate-300">
                    {cam.latency_ms} ms
                  </td>
                  <td className="py-3 px-3 text-right font-mono tabular-nums text-slate-300">
                    {cam.brightness} / {cam.contrast}
                  </td>
                  <td className="py-3 px-3 text-right font-mono tabular-nums text-slate-300">
                    {cam.frame_count}
                  </td>
                  <td className="py-3 px-4 text-right space-x-2 whitespace-nowrap">
                    <button
                      type="button"
                      onClick={() => {
                        onActivateSession({
                          camera: cam,
                          demoVideoUrl:
                            cam.source_type === 'VIDEO_FILE' && cam.stream_url ? cam.stream_url : undefined,
                        });
                        onNavigate('live');
                      }}
                      className="px-2.5 py-1 rounded bg-blue-600/20 text-blue-300 hover:bg-blue-600/30"
                    >
                      Monitor
                    </button>
                    {cam.status === 'CONNECTED' && (
                      <button
                        type="button"
                        onClick={() => handleDisconnect(cam.id)}
                        className="px-2.5 py-1 rounded bg-slate-800 text-slate-300 hover:bg-slate-700"
                      >
                        Disconnect
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => handleDelete(cam.id)}
                      className="p-1 text-slate-500 hover:text-red-400 align-middle"
                      title="Delete camera"
                    >
                      <Trash2 className="w-3.5 h-3.5 inline" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};

interface DetectionPageProps {
  config: CVConfigSettings;
  latestTelemetry: LiveTelemetryPayload | null;
  onUpdateConfig: (next: Partial<CVConfigSettings>) => Promise<void>;
}

export const DetectionPage: React.FC<DetectionPageProps> = ({
  config,
  latestTelemetry,
  onUpdateConfig,
}) => {
  const [conf, setConf] = useState(config.yolo_confidence);
  const [imgsz, setImgsz] = useState(config.yolo_imgsz);
  const [intervalMs, setIntervalMs] = useState(config.inference_interval_ms);
  const [saved, setSaved] = useState(false);

  const handleSave = async () => {
    await onUpdateConfig({
      yolo_confidence: conf,
      yolo_imgsz: imgsz,
      inference_interval_ms: intervalMs,
    });
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const tracks = latestTelemetry?.detections || [];

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      <div className="border-b border-slate-800 pb-4">
        <h1 className="font-display text-xl font-semibold text-slate-100">
          Module 4 · Human/Object Detection &amp; Multi-Object Tracking
        </h1>
        <p className="text-xs text-slate-400 mt-0.5">
          Target classes: person, car, motorcycle, bus, truck, bicycle, backpack, bag · ByteTrack / IoU persistent tracking
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        <div className="lg:col-span-4 bg-[#0f172a] border border-slate-800 rounded-lg p-5 space-y-4">
          <h2 className="font-display text-sm font-semibold text-slate-200">Detector Parameters</h2>
          <div className="space-y-3 text-xs">
            <div>
              <div className="flex justify-between text-slate-300 mb-1">
                <span>Confidence Threshold</span>
                <span className="font-mono tabular-nums">{conf.toFixed(2)}</span>
              </div>
              <input
                type="range"
                min={0.15}
                max={0.9}
                step={0.05}
                value={conf}
                onChange={(e) => setConf(Number(e.target.value))}
                className="w-full"
              />
            </div>

            <div>
              <label className="block text-slate-300 mb-1">YOLO Image Size (px)</label>
              <select
                value={imgsz}
                onChange={(e) => setImgsz(Number(e.target.value))}
                className="w-full bg-slate-950 border border-slate-800 rounded px-3 py-2 text-slate-100 font-mono"
              >
                <option value={320}>320 (Fastest CPU)</option>
                <option value={416}>416 (Balanced i5)</option>
                <option value={640}>640 (Standard Precision)</option>
              </select>
            </div>

            <div>
              <label className="block text-slate-300 mb-1">Inference Interval (ms)</label>
              <input
                type="number"
                min={40}
                max={2000}
                step={20}
                value={intervalMs}
                onChange={(e) => setIntervalMs(Number(e.target.value))}
                className="w-full bg-slate-950 border border-slate-800 rounded px-3 py-2 text-slate-100 font-mono"
              />
            </div>

            <button
              type="button"
              onClick={handleSave}
              className="w-full py-2 px-4 rounded bg-blue-600 hover:bg-blue-500 text-xs font-semibold text-white"
            >
              {saved ? 'Configuration Saved' : 'Apply Detection Settings'}
            </button>
          </div>
        </div>

        <div className="lg:col-span-8 bg-[#0f172a] border border-slate-800 rounded-lg p-5 space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="font-display text-sm font-semibold text-slate-200">Active Tracked Objects</h2>
            <span className="font-mono text-xs text-slate-400 tabular-nums">
              {tracks.length} active tracks
            </span>
          </div>

          {tracks.length === 0 ? (
            <div className="text-xs text-slate-500 py-8 text-center">
              No active detections in the current frame. Start a camera or demo video in Live Monitor.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs border-collapse">
                <thead>
                  <tr className="border-b border-slate-800 text-slate-400">
                    <th className="py-2.5 px-3">Track ID</th>
                    <th className="py-2.5 px-3">Class</th>
                    <th className="py-2.5 px-3 text-right">Confidence</th>
                    <th className="py-2.5 px-3 text-right">Displacement</th>
                    <th className="py-2.5 px-3 text-right">Pixel Velocity</th>
                    <th className="py-2.5 px-3 text-right">Trail Pts</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/80">
                  {tracks.map((t) => (
                    <tr key={t.track_id}>
                      <td className="py-2.5 px-3 font-mono font-semibold text-blue-300">
                        ID {String(t.track_id).padStart(2, '0')}
                      </td>
                      <td className="py-2.5 px-3 uppercase font-medium text-slate-200">{t.class_name}</td>
                      <td className="py-2.5 px-3 text-right font-mono tabular-nums text-slate-300">
                        {t.confidence.toFixed(2)}
                      </td>
                      <td className="py-2.5 px-3 text-right font-mono tabular-nums text-slate-300">
                        {t.displacement_px} px
                      </td>
                      <td className="py-2.5 px-3 text-right font-mono tabular-nums text-slate-300">
                        {t.velocity_px_per_sec} px/s
                      </td>
                      <td className="py-2.5 px-3 text-right font-mono tabular-nums text-slate-400">
                        {t.trajectory.length}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
