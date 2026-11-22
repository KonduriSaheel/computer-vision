import React, { useCallback, useEffect, useState } from 'react';
import { Pause, Play, Upload } from 'lucide-react';
import {
  Area,
  AreaChart,
  CartesianGrid,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { apiFetch, setMemoryAuthToken } from '../lib/api.ts';
import type {
  CVConfigSettings,
  CalibrationRecord,
  CameraRecord,
  SystemHealthSnapshot,
  SystemResourcePoint,
} from '../types/visionguard.ts';

interface CalibrationPageProps {
  cameras: CameraRecord[];
}

export const CalibrationPage: React.FC<CalibrationPageProps> = ({ cameras }) => {
  const [calibrations, setCalibrations] = useState<CalibrationRecord[]>([]);
  const [cameraId, setCameraId] = useState(cameras[0]?.id || '');
  const [cols, setCols] = useState(9);
  const [rows, setRows] = useState(6);
  const [squareSizeMm, setSquareSizeMm] = useState(25);
  const [files, setFiles] = useState<FileList | null>(null);
  const [running, setRunning] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadCalibrations = useCallback(async () => {
    try {
      const res = await apiFetch<{ calibrations: CalibrationRecord[] }>('/api/calibration');
      setCalibrations(res.calibrations);
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    loadCalibrations();
  }, [loadCalibrations]);

  useEffect(() => {
    if (!cameraId && cameras.length > 0) {
      setCameraId(cameras[0].id);
    }
  }, [cameras, cameraId]);

  const handleRunCalibration = async (e: React.FormEvent) => {
    e.preventDefault();
    setMessage(null);
    setError(null);
    if (!cameraId) {
      setError('Select a registered camera first.');
      return;
    }
    if (!files || files.length < 3) {
      setError('Select at least 3 chessboard images.');
      return;
    }
    setRunning(true);
    try {
      const form = new FormData();
      form.append('chessboard_cols', String(cols));
      form.append('chessboard_rows', String(rows));
      form.append('square_size_mm', String(squareSizeMm));
      for (let i = 0; i < files.length; i++) {
        form.append('images', files[i]);
      }
      const res = await apiFetch<{ calibration: CalibrationRecord }>(`/api/calibration/${cameraId}/upload`, {
        method: 'POST',
        body: form,
      });
      await loadCalibrations();
      if (res.calibration.status === 'CALIBRATED') {
        setMessage(
          `Calibration succeeded with reprojection error ${res.calibration.reprojection_error} px.`
        );
      } else {
        setMessage(res.calibration.error_message || `Status: ${res.calibration.status}`);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Calibration request failed.');
    } finally {
      setRunning(false);
    }
  };

  const camName = (id: string) => cameras.find((c) => c.id === id)?.name || id;

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      <div className="border-b border-slate-800 pb-4">
        <h1 className="font-display text-xl font-semibold text-slate-100">
          Module 1 · OpenCV Chessboard Camera Calibration
        </h1>
        <p className="text-xs text-slate-400 mt-0.5">
          Compute intrinsic camera matrix, distortion coefficients, and reprojection error per camera (object detection works normally without calibration)
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        <form onSubmit={handleRunCalibration} className="lg:col-span-5 bg-[#0f172a] border border-slate-800 rounded-lg p-5 space-y-3.5 text-xs">
          <h2 className="font-display text-sm font-semibold text-slate-200">Run Chessboard Calibration</h2>
          <div>
            <label className="block text-slate-300 mb-1">Target Camera</label>
            <select
              value={cameraId}
              onChange={(e) => setCameraId(e.target.value)}
              className="w-full bg-slate-950 border border-slate-800 rounded px-3 py-2 text-slate-100"
            >
              <option value="">Select camera...</option>
              {cameras.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name} ({c.source_type})
                </option>
              ))}
            </select>
          </div>
          <div className="grid grid-cols-3 gap-2.5">
            <div>
              <label className="block text-slate-300 mb-1">Inner Cols</label>
              <input
                type="number"
                value={cols}
                onChange={(e) => setCols(Number(e.target.value))}
                className="w-full bg-slate-950 border border-slate-800 rounded px-2.5 py-2 font-mono text-slate-100"
              />
            </div>
            <div>
              <label className="block text-slate-300 mb-1">Inner Rows</label>
              <input
                type="number"
                value={rows}
                onChange={(e) => setRows(Number(e.target.value))}
                className="w-full bg-slate-950 border border-slate-800 rounded px-2.5 py-2 font-mono text-slate-100"
              />
            </div>
            <div>
              <label className="block text-slate-300 mb-1">Square (mm)</label>
              <input
                type="number"
                value={squareSizeMm}
                onChange={(e) => setSquareSizeMm(Number(e.target.value))}
                className="w-full bg-slate-950 border border-slate-800 rounded px-2.5 py-2 font-mono text-slate-100"
              />
            </div>
          </div>

          <label className="flex items-center justify-center gap-2 border border-dashed border-slate-700 rounded-md p-4 cursor-pointer hover:border-blue-500/60">
            <Upload className="w-4 h-4 text-slate-400" />
            <span className="text-slate-300">
              {files && files.length > 0 ? `${files.length} chessboard image(s) selected` : 'Upload chessboard calibration images'}
            </span>
            <input
              type="file"
              multiple
              accept="image/jpeg,image/png"
              onChange={(e) => setFiles(e.target.files)}
              className="hidden"
            />
          </label>

          {message && <div className="p-2.5 rounded bg-blue-950/30 border border-blue-800/60 text-blue-200">{message}</div>}
          {error && <div className="p-2.5 rounded bg-red-950/30 border border-red-800/60 text-red-300">{error}</div>}

          <button
            type="submit"
            disabled={running}
            className="w-full py-2.5 px-4 rounded bg-blue-600 hover:bg-blue-500 font-semibold text-white"
          >
            {running ? 'Running OpenCV Calibration...' : 'Upload & Calibrate'}
          </button>
        </form>

        <div className="lg:col-span-7 bg-[#0f172a] border border-slate-800 rounded-lg p-5 space-y-3">
          <h2 className="font-display text-sm font-semibold text-slate-200">Saved Calibration Profiles</h2>
          {calibrations.length === 0 ? (
            <div className="text-xs text-slate-500 py-8 text-center">
              No camera calibrations recorded yet (status: NOT CALIBRATED).
            </div>
          ) : (
            <div className="space-y-3">
              {calibrations.map((cal) => (
                <div key={cal.id} className="p-3.5 rounded bg-slate-950 border border-slate-800 text-xs space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="font-semibold text-slate-100">{camName(cal.camera_id)}</span>
                    <span
                      className={`font-mono font-semibold ${
                        cal.status === 'CALIBRATED'
                          ? 'text-emerald-400'
                          : cal.status === 'CALIBRATION_FAILED'
                            ? 'text-red-400'
                            : 'text-amber-400'
                      }`}
                    >
                      {cal.status}
                    </span>
                  </div>
                  <div className="font-mono text-[11px] text-slate-400 tabular-nums">
                    Board: {cal.chessboard_cols}x{cal.chessboard_rows} ({cal.square_size_mm} mm) · Valid images:{' '}
                    {cal.valid_image_count}/{cal.image_count}
                    {cal.reprojection_error !== null ? ` · Reprojection Error: ${cal.reprojection_error} px` : ''}
                  </div>
                  {cal.camera_matrix_json && (
                    <pre className="bg-[#0b1120] p-2 rounded font-mono text-[10px] text-slate-300 overflow-x-auto">
                      K = {cal.camera_matrix_json}
                      {'\n'}D = {cal.dist_coeffs_json}
                    </pre>
                  )}
                  {cal.error_message && <div className="text-amber-300/90">{cal.error_message}</div>}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

interface SystemHealthPageProps {
  health: SystemHealthSnapshot | null;
  resourceHistory: SystemResourcePoint[];
  logs: Array<{ id: number; level: string; module: string; message: string; created_at: string }>;
  config: CVConfigSettings;
  wsConnected: boolean;
  onUpdateConfig: (next: Partial<CVConfigSettings>) => Promise<void>;
  onRefreshHealth: () => Promise<void>;
}

export const SystemHealthPage: React.FC<SystemHealthPageProps> = ({
  health,
  resourceHistory,
  logs,
  config,
  wsConnected,
  onUpdateConfig,
  onRefreshHealth,
}) => {
  const [cvUrl, setCvUrl] = useState(config.cv_service_url);
  const [edgeEnabled, setEdgeEnabled] = useState(config.browser_edge_cv_enabled);
  const [savedMsg, setSavedMsg] = useState<string | null>(null);
  const [streamPaused, setStreamPaused] = useState(false);
  const [windowSize, setWindowSize] = useState<30 | 90>(30);
  const [frozenSnapshot, setFrozenSnapshot] = useState<SystemResourcePoint[] | null>(null);

  // Operator Auth state
  const [authStatus, setAuthStatus] = useState<{
    envPasscodeConfigured: boolean;
    claimed: boolean;
    claimedUsername: string | null;
    operator: { sub: string; role: string } | null;
  } | null>(null);
  const [authUser, setAuthUser] = useState('operator');
  const [authPass, setAuthPass] = useState('');
  const [authMsg, setAuthMsg] = useState<string | null>(null);

  const loadAuth = useCallback(async () => {
    try {
      const res = await apiFetch<typeof authStatus>('/api/auth/status');
      setAuthStatus(res);
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    loadAuth();
  }, [loadAuth]);

  const handleSaveServiceConfig = async () => {
    await onUpdateConfig({
      cv_service_url: cvUrl.trim(),
      browser_edge_cv_enabled: edgeEnabled,
    });
    await onRefreshHealth();
    setSavedMsg('CV engine configuration updated.');
    setTimeout(() => setSavedMsg(null), 2500);
  };

  const handleAuthSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthMsg(null);
    try {
      const endpoint = authStatus && !authStatus.envPasscodeConfigured && !authStatus.claimed ? '/api/auth/claim' : '/api/auth/login';
      const res = await apiFetch<{ token: string; operator: { sub: string; role: string } }>(endpoint, {
        method: 'POST',
        body: JSON.stringify({ username: authUser, password: authPass }),
      });
      setMemoryAuthToken(res.token);
      setAuthPass('');
      await loadAuth();
      setAuthMsg(`Signed in as ${res.operator.sub} (${res.operator.role}).`);
    } catch (err) {
      setAuthMsg(err instanceof Error ? err.message : 'Authentication failed.');
    }
  };

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      <div className="flex items-center justify-between border-b border-slate-800 pb-4">
        <div>
          <h1 className="font-display text-xl font-semibold text-slate-100">System Health &amp; Diagnostics</h1>
          <p className="text-xs text-slate-400 mt-0.5">
            Live host resource usage, Python CV service connectivity, model status, and operator authentication
          </p>
        </div>
        <div className="flex items-center gap-2.5">
          <a
            href="/api/export/zip"
            download="visionguard-capstone.zip"
            className="px-3.5 py-2 rounded bg-blue-600 hover:bg-blue-500 text-xs font-semibold text-white whitespace-nowrap"
          >
            Download Project ZIP
          </a>
          <button
            type="button"
            onClick={onRefreshHealth}
            className="px-3.5 py-2 rounded border border-slate-700 bg-slate-900 hover:bg-slate-800 text-xs text-slate-200 whitespace-nowrap"
          >
            Refresh Diagnostics
          </button>
        </div>
      </div>

      {health && (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3.5 text-xs">
          {[
            { label: 'Overall State', value: health.overall_state },
            { label: 'CPU Load', value: `${health.cpu_usage_pct}%` },
            { label: 'RAM Usage', value: `${health.ram_used_mb} / ${health.ram_total_mb} MB (${health.ram_usage_pct}%)` },
            { label: 'GPU / Accelerator', value: health.gpu_status },
            { label: 'Database', value: health.database_status },
            { label: 'WebSocket (/ws/live)', value: wsConnected ? `HEALTHY (${health.websocket_clients} clients)` : 'WARNING' },
            { label: 'Python CV Service', value: `${health.cv_service_status}` },
            { label: 'YOLO Model', value: health.yolo_model_status },
            { label: 'Face Model', value: health.face_model_status },
            { label: 'Active Cameras', value: `${health.active_cameras}` },
          ].map((m) => (
            <div key={m.label} className="bg-[#0f172a] border border-slate-800 rounded-lg p-3.5">
              <div className="text-slate-400">{m.label}</div>
              <div className="font-mono text-xs font-semibold text-slate-100 mt-1 break-words tabular-nums">
                {m.value}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Live Streaming CPU & Memory Graph */}
      {(() => {
        const sourceSeries = streamPaused && frozenSnapshot ? frozenSnapshot : resourceHistory;
        const chartSeries = sourceSeries.slice(-windowSize);
        const peakCpu = chartSeries.reduce((m, p) => Math.max(m, p.cpu_usage_pct), 0);
        const avgCpu = chartSeries.length
          ? Number((chartSeries.reduce((s, p) => s + p.cpu_usage_pct, 0) / chartSeries.length).toFixed(1))
          : 0;
        const peakRam = chartSeries.reduce((m, p) => Math.max(m, p.ram_usage_pct), 0);
        const latestPt = chartSeries[chartSeries.length - 1];

        return (
          <div className="bg-[#0f172a] border border-slate-800 rounded-lg p-5 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="font-display text-sm font-semibold text-slate-100">
                  Live Host Resource Utilization (CPU &amp; Memory)
                </h2>
                <div className="text-xs text-slate-400 mt-0.5 flex flex-wrap items-center gap-3 font-mono tabular-nums">
                  <span className="text-blue-400">
                    CPU: {latestPt ? `${latestPt.cpu_usage_pct}%` : '0%'} (Peak {peakCpu.toFixed(1)}% · Avg {avgCpu}%)
                  </span>
                  <span className="text-slate-600" aria-hidden="true">/</span>
                  <span className="text-violet-400">
                    RAM: {latestPt ? `${latestPt.ram_usage_pct}% (${latestPt.ram_used_mb} MB)` : '0%'} (Peak {peakRam.toFixed(1)}%)
                  </span>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <div className="flex items-center bg-slate-950 border border-slate-800 rounded-md p-0.5 text-[11px]">
                  <button
                    type="button"
                    onClick={() => setWindowSize(30)}
                    className={`px-2.5 py-1 rounded transition-colors whitespace-nowrap ${
                      windowSize === 30 ? 'bg-slate-800 text-slate-100 font-medium' : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    1m Window
                  </button>
                  <button
                    type="button"
                    onClick={() => setWindowSize(90)}
                    className={`px-2.5 py-1 rounded transition-colors whitespace-nowrap ${
                      windowSize === 90 ? 'bg-slate-800 text-slate-100 font-medium' : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    3m Window
                  </button>
                </div>

                <button
                  type="button"
                  onClick={() => {
                    if (!streamPaused) {
                      setFrozenSnapshot(resourceHistory);
                      setStreamPaused(true);
                    } else {
                      setFrozenSnapshot(null);
                      setStreamPaused(false);
                    }
                  }}
                  className="px-3 py-1.5 rounded border border-slate-700 bg-slate-900 hover:bg-slate-800 text-xs text-slate-200 flex items-center gap-1.5 whitespace-nowrap"
                >
                  {streamPaused ? <Play className="w-3.5 h-3.5 text-emerald-400" /> : <Pause className="w-3.5 h-3.5 text-amber-400" />}
                  <span>{streamPaused ? 'Resume Stream' : 'Pause Stream'}</span>
                </button>
              </div>
            </div>

            {chartSeries.length === 0 ? (
              <div className="h-64 flex items-center justify-center text-xs text-slate-500 border border-dashed border-slate-800 rounded">
                Awaiting live host telemetry samples from /ws/live...
              </div>
            ) : (
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={chartSeries} margin={{ top: 8, right: 12, left: -12, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                    <XAxis
                      dataKey="time"
                      tick={{ fontSize: 10, fill: '#94a3b8' }}
                      minTickGap={24}
                    />
                    <YAxis
                      domain={[0, 100]}
                      unit="%"
                      tick={{ fontSize: 10, fill: '#94a3b8' }}
                    />
                    <Tooltip
                      contentStyle={{
                        backgroundColor: '#0b1120',
                        borderColor: '#334155',
                        borderRadius: '6px',
                        fontSize: '12px',
                        fontFamily: 'IBM Plex Mono, monospace',
                      }}
                      formatter={(value: unknown, name: unknown) => [`${value}%`, String(name)]}
                    />
                    <ReferenceLine
                      y={80}
                      stroke="#f59e0b"
                      strokeDasharray="4 4"
                      label={{ value: '80% Bottleneck Threshold', position: 'insideTopRight', fill: '#f59e0b', fontSize: 10 }}
                    />
                    <Area
                      type="monotone"
                      dataKey="cpu_usage_pct"
                      name="CPU Usage"
                      stroke="#3b82f6"
                      strokeWidth={2}
                      fill="#3b82f6"
                      fillOpacity={0.18}
                      isAnimationActive={false}
                    />
                    <Area
                      type="monotone"
                      dataKey="ram_usage_pct"
                      name="Memory Usage"
                      stroke="#8b5cf6"
                      strokeWidth={2}
                      fill="#8b5cf6"
                      fillOpacity={0.16}
                      isAnimationActive={false}
                    />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            )}
          </div>
        );
      })()}

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Python CV Service Bridge + Windows Setup */}
        <div className="lg:col-span-6 bg-[#0f172a] border border-slate-800 rounded-lg p-5 space-y-4 text-xs">
          <h2 className="font-display text-sm font-semibold text-slate-200">
            Python FastAPI CV Service Integration
          </h2>
          <div>
            <label className="block text-slate-300 mb-1">CV Service URL</label>
            <input
              type="text"
              value={cvUrl}
              onChange={(e) => setCvUrl(e.target.value)}
              className="w-full bg-slate-950 border border-slate-800 rounded px-3 py-2 font-mono text-slate-100"
            />
          </div>
          <label className="flex items-center gap-2 text-slate-300">
            <input
              type="checkbox"
              checked={edgeEnabled}
              onChange={(e) => setEdgeEnabled(e.target.checked)}
            />
            <span>Enable Browser Edge CV (TensorFlow.js COCO-SSD + IoU Tracker) when Python CV Service is offline</span>
          </label>
          {savedMsg && <div className="text-emerald-400">{savedMsg}</div>}
          <button
            type="button"
            onClick={handleSaveServiceConfig}
            className="px-4 py-2 rounded bg-blue-600 hover:bg-blue-500 font-semibold text-white"
          >
            Save Engine Settings
          </button>

          <div className="pt-3 border-t border-slate-800 space-y-1.5 text-slate-400">
            <div className="font-semibold text-slate-200">Local Windows Setup (cv_service/)</div>
            <div>1. Install Python 3.10 or 3.11 and run <code className="text-slate-200">cv_service\setup_windows.bat</code></div>
            <div>2. Start FastAPI YOLOv8n + ByteTrack + ArcFace via <code className="text-slate-200">cv_service\run_windows.bat</code></div>
            <div>3. Expose port 8000 (or use localhost if running Node.js locally) and enter the URL above.</div>
          </div>
        </div>

        {/* Operator Auth Claim / Sign-In */}
        <div className="lg:col-span-6 bg-[#0f172a] border border-slate-800 rounded-lg p-5 space-y-4 text-xs">
          <h2 className="font-display text-sm font-semibold text-slate-200">Operator Authentication &amp; Access</h2>
          {authStatus?.operator ? (
            <div className="space-y-3">
              <div className="p-3 rounded bg-emerald-950/30 border border-emerald-800/60 text-emerald-300">
                Active Operator Session: <strong>{authStatus.operator.sub}</strong> ({authStatus.operator.role})
              </div>
              <button
                type="button"
                onClick={() => {
                  setMemoryAuthToken(null);
                  loadAuth();
                }}
                className="px-3.5 py-2 rounded bg-slate-800 hover:bg-slate-700 text-slate-200"
              >
                Sign Out
              </button>
            </div>
          ) : (
            <form onSubmit={handleAuthSubmit} className="space-y-3">
              <div className="text-slate-400">
                {authStatus && !authStatus.envPasscodeConfigured && !authStatus.claimed
                  ? 'First-run setup: claim the server-side admin operator password (stored hashed with scrypt).'
                  : 'Sign in with your operator password or VISIONGUARD_ADMIN_PASSCODE.'}
              </div>
              <div className="grid grid-cols-2 gap-3">
                <input
                  type="text"
                  value={authUser}
                  onChange={(e) => setAuthUser(e.target.value)}
                  placeholder="Username"
                  className="bg-slate-950 border border-slate-800 rounded px-3 py-2 text-slate-100"
                />
                <input
                  type="password"
                  value={authPass}
                  onChange={(e) => setAuthPass(e.target.value)}
                  placeholder="Password (min 8 chars)"
                  className="bg-slate-950 border border-slate-800 rounded px-3 py-2 text-slate-100"
                />
              </div>
              {authMsg && <div className="text-blue-300">{authMsg}</div>}
              <button
                type="submit"
                className="px-4 py-2 rounded bg-blue-600 hover:bg-blue-500 font-semibold text-white"
              >
                {authStatus && !authStatus.envPasscodeConfigured && !authStatus.claimed
                  ? 'Claim Admin Account'
                  : 'Sign In'}
              </button>
            </form>
          )}
        </div>
      </div>

      {/* System Logs */}
      <div className="bg-[#0f172a] border border-slate-800 rounded-lg p-5 space-y-3">
        <h2 className="font-display text-sm font-semibold text-slate-200">Backend System Logs</h2>
        <div className="max-h-64 overflow-y-auto divide-y divide-slate-800/80 font-mono text-[11px]">
          {logs.length === 0 ? (
            <div className="text-slate-500 py-4">No system logs recorded yet.</div>
          ) : (
            logs.map((l) => (
              <div key={l.id} className="py-2 flex items-start gap-3">
                <span className="text-slate-500 shrink-0 tabular-nums">
                  {new Date(l.created_at).toLocaleTimeString()}
                </span>
                <span
                  className={`shrink-0 font-semibold ${
                    l.level === 'ERROR'
                      ? 'text-red-400'
                      : l.level === 'WARN'
                        ? 'text-amber-400'
                        : 'text-blue-400'
                  }`}
                >
                  [{l.level}]
                </span>
                <span className="text-slate-400 shrink-0">{l.module}</span>
                <span className="text-slate-200">{l.message}</span>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
};
