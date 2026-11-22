import { useCallback, useEffect, useState } from 'react';
import { MobileBroadcaster } from './components/MobileBroadcaster.tsx';
import { Sidebar } from './components/Sidebar.tsx';
import { apiFetch } from './lib/api.ts';
import { AnalyticsPage } from './pages/AnalyticsPage.tsx';
import { CalibrationPage, SystemHealthPage } from './pages/CalibrationHealthPages.tsx';
import { CamerasPage, DetectionPage } from './pages/CamerasDetectionPages.tsx';
import { ConnectionScreen, type ActiveSessionConfig } from './pages/ConnectionScreen.tsx';
import { DashboardPage } from './pages/DashboardPage.tsx';
import { IdentitiesPage } from './pages/IdentitiesPage.tsx';
import { EvidencePage, IncidentsPage } from './pages/IncidentsEvidencePages.tsx';
import { LiveMonitorPage } from './pages/LiveMonitorPage.tsx';
import { ZonesPage } from './pages/ZonesPage.tsx';
import type {
  AppPage,
  CVConfigSettings,
  CameraRecord,
  IncidentEventRecord,
  LiveTelemetryPayload,
  SystemHealthSnapshot,
  SystemResourcePoint,
} from './types/visionguard.ts';

export default function App() {
  // Check if opened on Mobile Broadcaster companion route (/mobile-cam)
  if (window.location.pathname === '/mobile-cam') {
    return <MobileBroadcaster />;
  }

  const [currentPage, setCurrentPage] = useState<AppPage>('connection');
  const [cameras, setCameras] = useState<CameraRecord[]>([]);
  const [activeSession, setActiveSession] = useState<ActiveSessionConfig | null>(null);

  const [config, setConfig] = useState<CVConfigSettings>({
    yolo_confidence: 0.45,
    yolo_imgsz: 640,
    inference_interval_ms: 120,
    crowd_normal_max: 4,
    crowd_elevated_max: 9,
    face_similarity_threshold: 0.62,
    event_cooldown_sec: 12,
    cv_service_url: 'http://localhost:8000',
    browser_edge_cv_enabled: true,
  });

  const [wsConnected, setWsConnected] = useState(false);
  const [latestTelemetry, setLatestTelemetry] = useState<LiveTelemetryPayload | null>(null);
  const [latestMobileFrame, setLatestMobileFrame] = useState<{
    camera_id: string;
    frame_data_url: string;
    width: number;
    height: number;
    capture_fps: number;
    latency_ms: number;
  } | null>(null);
  const [recentAlerts, setRecentAlerts] = useState<IncidentEventRecord[]>([]);
  const [unackCount, setUnackCount] = useState(0);
  const [health, setHealth] = useState<SystemHealthSnapshot | null>(null);
  const [resourceHistory, setResourceHistory] = useState<SystemResourcePoint[]>([]);
  const [systemLogs, setSystemLogs] = useState<
    Array<{ id: number; level: string; module: string; message: string; created_at: string }>
  >([]);

  const refreshCameras = useCallback(async () => {
    try {
      const res = await apiFetch<{ cameras: CameraRecord[] }>('/api/cameras');
      setCameras(res.cameras);
    } catch {
      // ignore
    }
  }, []);

  const refreshConfig = useCallback(async () => {
    try {
      const res = await apiFetch<{ config: CVConfigSettings }>('/api/config');
      setConfig(res.config);
    } catch {
      // ignore
    }
  }, []);

  const refreshHealth = useCallback(async () => {
    try {
      const res = await apiFetch<{
        health: SystemHealthSnapshot;
        history?: SystemResourcePoint[];
        logs: Array<{ id: number; level: string; module: string; message: string; created_at: string }>;
      }>('/api/health');
      setHealth(res.health);
      if (Array.isArray(res.history) && res.history.length > 0) {
        setResourceHistory(res.history);
      }
      setSystemLogs(res.logs);
    } catch {
      // ignore
    }
  }, []);

  const refreshUnackCount = useCallback(async () => {
    try {
      const res = await apiFetch<{ incidents: IncidentEventRecord[] }>('/api/incidents?status=NEW');
      setUnackCount(res.incidents.length);
      setRecentAlerts((prev) => (prev.length === 0 ? res.incidents.slice(0, 10) : prev));
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    refreshCameras();
    refreshConfig();
    refreshHealth();
    refreshUnackCount();
    const healthTimer = window.setInterval(refreshHealth, 10000);
    return () => window.clearInterval(healthTimer);
  }, [refreshCameras, refreshConfig, refreshHealth, refreshUnackCount]);

  // Real-time /ws/live WebSocket with auto-reconnect
  useEffect(() => {
    let ws: WebSocket | null = null;
    let reconnectTimer: number | null = null;
    let closedByCleanup = false;

    const connectWs = () => {
      const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      ws = new WebSocket(`${proto}//${window.location.host}/ws/live`);

      ws.onopen = () => {
        setWsConnected(true);
      };

      ws.onmessage = (evt) => {
        try {
          const msg = JSON.parse(evt.data) as {
            type: string;
            payload?: LiveTelemetryPayload;
            event?: IncidentEventRecord;
            resourceHistory?: SystemResourcePoint[];
            point?: SystemResourcePoint;
            camera_id?: string;
            frame_data_url?: string;
            width?: number;
            height?: number;
            capture_fps?: number;
            latency_ms?: number;
          };

          if (msg.type === 'init' && Array.isArray(msg.resourceHistory)) {
            setResourceHistory(msg.resourceHistory);
          } else if (msg.type === 'system_metrics' && msg.point) {
            const pt = msg.point;
            setResourceHistory((prev) => [...prev, pt].slice(-90));
            setHealth((prev) =>
              prev
                ? {
                    ...prev,
                    cpu_usage_pct: pt.cpu_usage_pct,
                    ram_usage_pct: pt.ram_usage_pct,
                    ram_used_mb: pt.ram_used_mb,
                    ram_total_mb: pt.ram_total_mb,
                  }
                : prev
            );
          } else if (msg.type === 'telemetry' && msg.payload) {
            setLatestTelemetry(msg.payload);
          } else if (msg.type === 'mobile_frame' && msg.camera_id && msg.frame_data_url) {
            setLatestMobileFrame({
              camera_id: msg.camera_id,
              frame_data_url: msg.frame_data_url,
              width: msg.width || 640,
              height: msg.height || 480,
              capture_fps: msg.capture_fps || 0,
              latency_ms: msg.latency_ms || 0,
            });
          } else if (msg.type === 'alert' && msg.event) {
            const ev = msg.event;
            setRecentAlerts((prev) => {
              if (prev.some((p) => p.id === ev.id)) return prev;
              return [ev, ...prev].slice(0, 20);
            });
            setUnackCount((c) => c + 1);
          } else if (msg.type === 'camera_status') {
            refreshCameras();
          }
        } catch {
          // ignore malformed socket frame
        }
      };

      ws.onclose = () => {
        setWsConnected(false);
        if (!closedByCleanup) {
          reconnectTimer = window.setTimeout(connectWs, 2500);
        }
      };

      ws.onerror = () => {
        ws?.close();
      };
    };

    connectWs();
    return () => {
      closedByCleanup = true;
      if (reconnectTimer !== null) window.clearTimeout(reconnectTimer);
      ws?.close();
    };
  }, [refreshCameras]);

  const handleDisconnectSession = async (cameraId: string) => {
    if (activeSession?.webcamStream) {
      activeSession.webcamStream.getTracks().forEach((t) => t.stop());
    }
    try {
      await apiFetch(`/api/cameras/${cameraId}`, {
        method: 'PATCH',
        body: JSON.stringify({ status: 'DISCONNECTED', is_active: 0 }),
      });
    } catch {
      // ignore
    }
    setActiveSession(null);
    await refreshCameras();
  };

  const handleUpdateConfig = async (next: Partial<CVConfigSettings>) => {
    await apiFetch('/api/config', {
      method: 'PATCH',
      body: JSON.stringify(next),
    });
    await refreshConfig();
  };

  const activeCameraCount = cameras.filter((c) => c.status === 'CONNECTED').length;

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-[#080d1a] text-slate-100">
      <Sidebar
        currentPage={currentPage}
        onNavigate={setCurrentPage}
        wsConnected={wsConnected}
        activeCameraCount={activeCameraCount}
        unacknowledgedAlerts={unackCount}
      />

      <main className="flex-1 overflow-y-auto bg-[#080d1a]">
        {currentPage === 'connection' && (
          <ConnectionScreen
            cameras={cameras}
            activeSession={activeSession}
            latestMobileFrame={latestMobileFrame}
            onRefreshCameras={refreshCameras}
            onActivateSession={setActiveSession}
            onDisconnectSession={handleDisconnectSession}
            onNavigate={setCurrentPage}
          />
        )}

        {currentPage === 'dashboard' && (
          <DashboardPage
            cameras={cameras}
            latestTelemetry={latestTelemetry}
            latestMobileFrame={latestMobileFrame}
            health={health}
            onNavigate={setCurrentPage}
          />
        )}

        {currentPage === 'live' && (
          <LiveMonitorPage
            activeSession={activeSession}
            cameras={cameras}
            config={config}
            latestMobileFrame={latestMobileFrame}
            latestPythonTelemetry={
              latestTelemetry && latestTelemetry.engine_label.startsWith('Python')
                ? latestTelemetry
                : null
            }
            recentAlerts={recentAlerts}
            onSelectSession={setActiveSession}
            onStopSession={() => {
              if (activeSession) {
                handleDisconnectSession(activeSession.camera.id);
              }
            }}
          />
        )}

        {currentPage === 'cameras' && (
          <CamerasPage
            cameras={cameras}
            onRefresh={refreshCameras}
            onActivateSession={setActiveSession}
            onNavigate={setCurrentPage}
          />
        )}

        {currentPage === 'detection' && (
          <DetectionPage
            config={config}
            latestTelemetry={latestTelemetry}
            onUpdateConfig={handleUpdateConfig}
          />
        )}

        {currentPage === 'identities' && <IdentitiesPage />}

        {currentPage === 'zones' && (
          <ZonesPage
            cameras={cameras}
            config={config}
            onUpdateConfig={handleUpdateConfig}
            onNavigate={setCurrentPage}
          />
        )}

        {currentPage === 'incidents' && (
          <IncidentsPage onNavigate={setCurrentPage} onRefreshCount={refreshUnackCount} />
        )}

        {currentPage === 'evidence' && <EvidencePage />}

        {currentPage === 'analytics' && <AnalyticsPage />}

        {currentPage === 'calibration' && <CalibrationPage cameras={cameras} />}

        {currentPage === 'health' && (
          <SystemHealthPage
            health={health}
            resourceHistory={resourceHistory}
            logs={systemLogs}
            config={config}
            wsConnected={wsConnected}
            onUpdateConfig={handleUpdateConfig}
            onRefreshHealth={refreshHealth}
          />
        )}
      </main>
    </div>
  );
}
