import type { IncomingMessage } from 'node:http';
import os from 'node:os';
import type { Duplex } from 'node:stream';
import { WebSocket, WebSocketServer } from 'ws';
import { db, logSystem } from './db.ts';
import type {
  IncidentEventRecord,
  LiveTelemetryPayload,
  SystemResourcePoint,
} from '../src/types/visionguard.ts';

function readCpuTotals(): { idle: number; total: number } {
  const cpus = os.cpus();
  let idle = 0;
  let total = 0;
  for (const cpu of cpus) {
    idle += cpu.times.idle;
    total += cpu.times.user + cpu.times.nice + cpu.times.sys + cpu.times.idle + cpu.times.irq;
  }
  return { idle, total };
}

class WebSocketHub {
  private liveWss: WebSocketServer;
  private ingestWss: WebSocketServer;
  private liveClients: Set<WebSocket> = new Set();
  private latestTelemetryByCamera: Map<string, LiveTelemetryPayload> = new Map();
  private mobileFrameMetrics: Map<
    string,
    { lastAt: number; fpsEma: number; frameCount: number; width: number; height: number }
  > = new Map();
  private prevCpuTotals = readCpuTotals();
  private resourceHistory: SystemResourcePoint[] = [];

  constructor() {
    this.liveWss = new WebSocketServer({ noServer: true });
    this.ingestWss = new WebSocketServer({ noServer: true });

    // Record initial sample and stream real host CPU & RAM telemetry every 2 seconds
    this.sampleSystemResources();
    const metricsTimer = setInterval(() => {
      const point = this.sampleSystemResources();
      if (this.liveClients.size > 0) {
        this.broadcast({
          type: 'system_metrics',
          point,
        });
      }
    }, 2000);
    metricsTimer.unref();

    this.liveWss.on('connection', (ws: WebSocket) => {
      this.liveClients.add(ws);
      ws.send(
        JSON.stringify({
          type: 'init',
          telemetry: Array.from(this.latestTelemetryByCamera.values()),
          resourceHistory: this.resourceHistory,
          timestamp: new Date().toISOString(),
        })
      );
      ws.on('close', () => {
        this.liveClients.delete(ws);
      });
      ws.on('error', () => {
        this.liveClients.delete(ws);
      });
    });

    this.ingestWss.on('connection', (ws: WebSocket, req: IncomingMessage) => {
      const url = new URL(req.url || '/', 'http://localhost');
      const parts = url.pathname.split('/').filter(Boolean);
      const cameraId = parts[2] || '';
      const token = url.searchParams.get('token') || '';

      const cam = db
        .prepare(`SELECT id, name, ingest_token, source_type FROM cameras WHERE id = ?`)
        .get(cameraId) as
        | { id: string; name: string; ingest_token: string | null; source_type: string }
        | undefined;

      if (!cam || !cam.ingest_token || cam.ingest_token !== token) {
        ws.close(1008, 'Unauthorized camera ingest token');
        return;
      }

      const now = new Date().toISOString();
      db.prepare(`UPDATE cameras SET status = 'CONNECTED', is_active = 1, last_error = NULL, updated_at = ? WHERE id = ?`).run(
        now,
        cameraId
      );
      logSystem('INFO', 'CameraIngest', `Mobile camera stream connected: ${cam.name}`, { cameraId });
      this.broadcast({
        type: 'camera_status',
        camera_id: cameraId,
        status: 'CONNECTED',
        timestamp: now,
      });

      ws.on('message', (raw: Buffer | string) => {
        try {
          const parsed = JSON.parse(raw.toString()) as {
            frame_data_url?: string;
            width?: number;
            height?: number;
            client_ts?: number;
            brightness?: number;
            contrast?: number;
          };
          if (!parsed.frame_data_url || !parsed.frame_data_url.startsWith('data:image/')) {
            return;
          }
          const nowMs = Date.now();
          const prev = this.mobileFrameMetrics.get(cameraId);
          let fps = 10;
          let count = 1;
          if (prev) {
            const dt = Math.max(1, nowMs - prev.lastAt);
            const instantFps = 1000 / dt;
            fps = prev.fpsEma * 0.7 + instantFps * 0.3;
            count = prev.frameCount + 1;
          }
          const width = Number(parsed.width) || 640;
          const height = Number(parsed.height) || 480;
          const latencyMs = parsed.client_ts ? Math.max(1, Math.min(5000, nowMs - parsed.client_ts)) : 28;
          const brightness = typeof parsed.brightness === 'number' ? parsed.brightness : 128;
          const contrast = typeof parsed.contrast === 'number' ? parsed.contrast : 48;

          this.mobileFrameMetrics.set(cameraId, {
            lastAt: nowMs,
            fpsEma: fps,
            frameCount: count,
            width,
            height,
          });

          const ts = new Date().toISOString();
          if (count % 5 === 0) {
            db.prepare(
              `UPDATE cameras SET status = 'CONNECTED', resolution_width = ?, resolution_height = ?, capture_fps = ?, latency_ms = ?, frame_count = ?, brightness = ?, contrast = ?, last_frame_at = ?, updated_at = ? WHERE id = ?`
            ).run(width, height, Number(fps.toFixed(1)), Math.round(latencyMs), count, brightness, contrast, ts, ts, cameraId);
          }

          this.broadcast({
            type: 'mobile_frame',
            camera_id: cameraId,
            camera_name: cam.name,
            frame_data_url: parsed.frame_data_url,
            width,
            height,
            capture_fps: Number(fps.toFixed(1)),
            latency_ms: Math.round(latencyMs),
            frame_count: count,
            brightness,
            contrast,
            timestamp: ts,
          });
        } catch {
          // Ignore malformed frame payload
        }
      });

      ws.on('close', () => {
        const closeTime = new Date().toISOString();
        db.prepare(
          `UPDATE cameras SET status = 'DISCONNECTED', is_active = 0, last_error = 'Mobile sender closed stream', updated_at = ? WHERE id = ?`
        ).run(closeTime, cameraId);
        logSystem('WARN', 'CameraIngest', `Mobile camera stream disconnected: ${cam.name}`, { cameraId });
        this.broadcast({
          type: 'camera_status',
          camera_id: cameraId,
          status: 'DISCONNECTED',
          message: `${cam.name} disconnected.`,
          timestamp: closeTime,
        });
      });
    });
  }

  public handleUpgrade(req: IncomingMessage, socket: Duplex, head: Buffer): boolean {
    const pathname = new URL(req.url || '/', 'http://localhost').pathname;
    if (pathname === '/ws/live') {
      this.liveWss.handleUpgrade(req, socket, head, (ws) => {
        this.liveWss.emit('connection', ws, req);
      });
      return true;
    }
    if (pathname.startsWith('/ws/ingest/')) {
      this.ingestWss.handleUpgrade(req, socket, head, (ws) => {
        this.ingestWss.emit('connection', ws, req);
      });
      return true;
    }
    return false;
  }

  public getLiveClientCount(): number {
    return this.liveClients.size;
  }

  public publishTelemetry(payload: LiveTelemetryPayload): void {
    this.latestTelemetryByCamera.set(payload.camera_id, payload);
    this.broadcast({
      type: 'telemetry',
      payload,
    });
  }

  public publishAlert(event: IncidentEventRecord): void {
    this.broadcast({
      type: 'alert',
      event,
    });
  }

  public broadcast(data: unknown): void {
    const serialized = JSON.stringify(data);
    for (const client of this.liveClients) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(serialized);
      }
    }
  }

  public sampleSystemResources(): SystemResourcePoint {
    const cur = readCpuTotals();
    const totalDiff = cur.total - this.prevCpuTotals.total;
    const idleDiff = cur.idle - this.prevCpuTotals.idle;
    this.prevCpuTotals = cur;

    let cpuPct = 0;
    if (totalDiff > 0) {
      cpuPct = Number(Math.max(0, Math.min(100, ((totalDiff - idleDiff) / totalDiff) * 100)).toFixed(1));
    } else {
      const load1m = os.loadavg()[0] || 0;
      cpuPct = Number(Math.min(100, (load1m / Math.max(1, os.cpus().length)) * 100).toFixed(1));
    }

    const totalMem = os.totalmem();
    const freeMem = os.freemem();
    const usedMem = totalMem - freeMem;
    const ramPct = Number(((usedMem / totalMem) * 100).toFixed(1));
    const now = new Date();

    const point: SystemResourcePoint = {
      timestamp: now.toISOString(),
      time: now.toISOString().slice(11, 19),
      cpu_usage_pct: cpuPct,
      ram_usage_pct: ramPct,
      ram_used_mb: Math.round(usedMem / (1024 * 1024)),
      ram_total_mb: Math.round(totalMem / (1024 * 1024)),
    };

    this.resourceHistory.push(point);
    if (this.resourceHistory.length > 90) {
      this.resourceHistory.shift();
    }
    return point;
  }

  public getResourceHistory(): SystemResourcePoint[] {
    return this.resourceHistory;
  }

  public getLatestResourceSample(): SystemResourcePoint {
    return (
      this.resourceHistory[this.resourceHistory.length - 1] || this.sampleSystemResources()
    );
  }
}

export const wsHub = new WebSocketHub();
