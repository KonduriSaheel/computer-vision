import React, { useEffect, useState } from 'react';
import { Eye } from 'lucide-react';
import { apiFetch } from '../lib/api.ts';
import type {
  AppPage,
  CameraRecord,
  IncidentEventRecord,
  LiveTelemetryPayload,
  SystemHealthSnapshot,
} from '../types/visionguard.ts';

interface DashboardPageProps {
  cameras: CameraRecord[];
  latestTelemetry: LiveTelemetryPayload | null;
  latestMobileFrame: { camera_id: string; frame_data_url: string } | null;
  health: SystemHealthSnapshot | null;
  onNavigate: (page: AppPage) => void;
}

interface AnalyticsSummary {
  total_events: number;
  alerts_today: number;
  critical_events: number;
  evidence_count: number;
  active_cameras: number;
}

export const DashboardPage: React.FC<DashboardPageProps> = ({
  cameras,
  latestTelemetry,
  latestMobileFrame,
  health,
  onNavigate,
}) => {
  const [summary, setSummary] = useState<AnalyticsSummary | null>(null);
  const [recentIncidents, setRecentIncidents] = useState<IncidentEventRecord[]>([]);

  useEffect(() => {
    const load = async () => {
      try {
        const [a, inc] = await Promise.all([
          apiFetch<{ summary: AnalyticsSummary }>('/api/analytics'),
          apiFetch<{ incidents: IncidentEventRecord[] }>('/api/incidents'),
        ]);
        setSummary(a.summary);
        setRecentIncidents(inc.incidents.slice(0, 8));
      } catch {
        // ignore
      }
    };
    load();
    const t = window.setInterval(load, 5000);
    return () => window.clearInterval(t);
  }, []);

  const activeCameraCount = cameras.filter((c) => c.status === 'CONNECTED').length;
  const totalObjects = latestTelemetry
    ? Object.values(latestTelemetry.object_counts).reduce((a, b) => a + b, 0)
    : 0;

  const kpis = [
    { label: 'Active Cameras', value: String(activeCameraCount) },
    { label: 'Current FPS', value: latestTelemetry ? `${latestTelemetry.processing_fps} fps` : '0 fps' },
    { label: 'Active Tracks', value: String(latestTelemetry?.active_tracks ?? 0) },
    { label: 'People Detected', value: String(latestTelemetry?.people_count ?? 0) },
    { label: 'Objects Detected', value: String(totalObjects) },
    { label: 'Alerts Today', value: String(summary?.alerts_today ?? 0) },
    { label: 'Critical / High Open', value: String(summary?.critical_events ?? 0) },
    { label: 'System Health', value: health?.overall_state || 'HEALTHY' },
  ];

  const previewSrc =
    latestTelemetry?.frame_data_url ||
    (latestMobileFrame ? latestMobileFrame.frame_data_url : null);

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800 pb-4">
        <div>
          <h1 className="font-display text-xl font-semibold text-slate-100">Operations Dashboard</h1>
          <p className="text-xs text-slate-400 mt-0.5">
            Real-time situational overview across all connected video streams and analytics
          </p>
        </div>
        <button
          type="button"
          onClick={() => onNavigate('live')}
          className="px-4 py-2 rounded-md bg-blue-600 hover:bg-blue-500 text-xs font-semibold text-white flex items-center gap-2 whitespace-nowrap"
        >
          <Eye className="w-4 h-4" />
          <span>Open Live Monitor</span>
        </button>
      </div>

      {/* 8 Real Metrics */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3.5">
        {kpis.map((k) => (
          <div key={k.label} className="bg-[#0f172a] border border-slate-800 rounded-lg p-4">
            <div className="text-xs text-slate-400">{k.label}</div>
            <div className="font-mono text-xl font-semibold tabular-nums text-slate-100 mt-1">
              {k.value}
            </div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Live Camera Preview + FPS & Latency */}
        <div className="lg:col-span-7 bg-[#0f172a] border border-slate-800 rounded-lg p-5 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="font-display text-sm font-semibold text-slate-200">Live Camera Preview</h2>
            <span className="font-mono text-xs tabular-nums text-slate-400">
              {latestTelemetry
                ? `${latestTelemetry.camera_name} · ${latestTelemetry.latency_ms} ms`
                : 'No active stream'}
            </span>
          </div>

          <div className="aspect-video bg-slate-950 border border-slate-800 rounded-md overflow-hidden flex items-center justify-center">
            {previewSrc ? (
              <img src={previewSrc} alt="Live camera preview" className="w-full h-full object-contain" />
            ) : (
              <div className="text-center p-6 text-xs text-slate-500 space-y-2">
                <div>No live camera frames currently active.</div>
                <button
                  type="button"
                  onClick={() => onNavigate('connection')}
                  className="text-blue-400 hover:text-blue-300 underline"
                >
                  Connect a camera or start Demo Mode
                </button>
              </div>
            )}
          </div>

          <div className="grid grid-cols-3 gap-3 pt-2 border-t border-slate-800/80 text-xs">
            <div>
              <div className="text-slate-500">Capture FPS</div>
              <div className="font-mono tabular-nums text-slate-200 mt-0.5">
                {latestTelemetry?.capture_fps ?? 0} fps
              </div>
            </div>
            <div>
              <div className="text-slate-500">Inference FPS</div>
              <div className="font-mono tabular-nums text-slate-200 mt-0.5">
                {latestTelemetry?.inference_fps ?? 0} fps
              </div>
            </div>
            <div>
              <div className="text-slate-500">End-to-End Latency</div>
              <div className="font-mono tabular-nums text-slate-200 mt-0.5">
                {latestTelemetry?.latency_ms ?? 0} ms
              </div>
            </div>
          </div>
        </div>

        {/* Detection Counts + Recent Incidents */}
        <div className="lg:col-span-5 space-y-5">
          <div className="bg-[#0f172a] border border-slate-800 rounded-lg p-5 space-y-3">
            <h2 className="font-display text-sm font-semibold text-slate-200">Live Detection Counts</h2>
            {!latestTelemetry || Object.keys(latestTelemetry.object_counts).length === 0 ? (
              <div className="text-xs text-slate-500">No data available.</div>
            ) : (
              <div className="grid grid-cols-2 gap-2 text-xs">
                {Object.entries(latestTelemetry.object_counts).map(([cls, count]) => (
                  <div
                    key={cls}
                    className="flex items-center justify-between bg-slate-950 border border-slate-800/80 rounded px-3 py-2"
                  >
                    <span className="capitalize text-slate-300">{cls}</span>
                    <span className="font-mono font-semibold tabular-nums text-slate-100">{count}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="bg-[#0f172a] border border-slate-800 rounded-lg p-5 space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="font-display text-sm font-semibold text-slate-200">Recent Incidents &amp; Timeline</h2>
              <button
                type="button"
                onClick={() => onNavigate('incidents')}
                className="text-xs text-blue-400 hover:text-blue-300"
              >
                View All
              </button>
            </div>
            {recentIncidents.length === 0 ? (
              <div className="text-xs text-slate-500 py-3">No incidents recorded yet.</div>
            ) : (
              <div className="divide-y divide-slate-800/80 max-h-72 overflow-y-auto">
                {recentIncidents.map((ev) => (
                  <div key={ev.id} className="py-2.5 text-xs space-y-1">
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
                      <span className="font-mono text-[11px] tabular-nums text-slate-500">
                        {new Date(ev.created_at).toLocaleTimeString()}
                      </span>
                    </div>
                    <div className="text-slate-300">{ev.description}</div>
                    {ev.reason && <div className="text-[11px] text-slate-500">{ev.reason}</div>}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
