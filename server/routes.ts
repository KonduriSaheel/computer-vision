import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import JSZip from 'jszip';
import multer from 'multer';
import { db, getConfigMap, logSystem } from './db.ts';
import {
  CALIBRATION_UPLOADS_ROOT,
  DATA_ROOT,
  EVIDENCE_ROOT,
  IDENTITY_UPLOADS_ROOT,
  SAMPLE_VIDEOS_ROOT,
  UPLOADS_ROOT,
  createSessionToken,
  hashPassword,
  resolveConfinedPath,
  validateExternalStreamUrl,
  validateStoredStreamUrl,
  verifyPassword,
} from './security.ts';
import { wsHub } from './wsHub.ts';
import type {
  CameraRecord,
  EventSeverity,
  EventType,
  HealthState,
  IncidentEventRecord,
  LiveTelemetryPayload,
} from '../src/types/visionguard.ts';

const SERVER_START_MS = Date.now();

function sanitizeFilename(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 120);
}

const videoUpload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, UPLOADS_ROOT),
    filename: (_req, file, cb) => cb(null, `${Date.now()}_${sanitizeFilename(file.originalname)}`),
  }),
  limits: { fileSize: 250 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (['.mp4', '.webm', '.mov', '.avi', '.mkv'].includes(ext)) {
      cb(null, true);
    } else {
      cb(new Error('Only .mp4, .webm, .mov, .avi, and .mkv video files are supported.'));
    }
  },
});

const imageUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024, files: 20 },
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (['.jpg', '.jpeg', '.png', '.webp'].includes(ext)) {
      cb(null, true);
    } else {
      cb(new Error('Only .jpg, .jpeg, .png, and .webp image files are supported.'));
    }
  },
});

const lastTelemetryPersistByCam = new Map<string, number>();

export function createApiRouter(): express.Router {
  const router = express.Router();

  // ---------------- AUTH ----------------
  router.get('/auth/status', (req, res) => {
    const envPasscodeSet = Boolean(process.env.VISIONGUARD_ADMIN_PASSCODE?.trim());
    const adminRow = db.prepare(`SELECT id, username, role, created_at FROM operator_auth LIMIT 1`).get() as
      | { id: string; username: string; role: string; created_at: string }
      | undefined;
    const operator = (req as express.Request & { operator?: { sub: string; role: string } }).operator || null;
    res.json({
      envPasscodeConfigured: envPasscodeSet,
      claimed: Boolean(adminRow),
      claimedUsername: adminRow?.username || null,
      operator,
    });
  });

  router.post('/auth/claim', (req, res) => {
    if (process.env.VISIONGUARD_ADMIN_PASSCODE?.trim()) {
      res.status(403).json({ error: 'Admin passcode is managed by environment secret.' });
      return;
    }
    const existing = db.prepare(`SELECT id FROM operator_auth LIMIT 1`).get();
    if (existing) {
      res.status(409).json({ error: 'Operator admin account has already been claimed.' });
      return;
    }
    const { username, password } = req.body as { username?: string; password?: string };
    const cleanUser = (username || 'operator').trim().slice(0, 64);
    if (!password || password.length < 8) {
      res.status(400).json({ error: 'Password must be at least 8 characters.' });
      return;
    }
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    db.prepare(`INSERT INTO operator_auth (id, username, password_hash, role, created_at) VALUES (?, ?, ?, 'ADMIN', ?)`).run(
      id,
      cleanUser,
      hashPassword(password),
      now
    );
    const token = createSessionToken(cleanUser, 'ADMIN');
    logSystem('INFO', 'Auth', `Admin operator claimed: ${cleanUser}`);
    res.json({ token, operator: { sub: cleanUser, role: 'ADMIN' } });
  });

  router.post('/auth/login', (req, res) => {
    const { username, password } = req.body as { username?: string; password?: string };
    if (!password) {
      res.status(400).json({ error: 'Password is required.' });
      return;
    }
    const envPasscode = process.env.VISIONGUARD_ADMIN_PASSCODE?.trim();
    if (envPasscode) {
      const a = Buffer.from(password);
      const b = Buffer.from(envPasscode);
      if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
        res.status(401).json({ error: 'Invalid operator passcode.' });
        return;
      }
      const user = (username || 'admin').trim().slice(0, 64);
      const token = createSessionToken(user, 'ADMIN');
      res.json({ token, operator: { sub: user, role: 'ADMIN' } });
      return;
    }

    const row = db
      .prepare(`SELECT username, password_hash, role FROM operator_auth WHERE username = ? OR role = 'ADMIN' LIMIT 1`)
      .get(username || 'operator') as { username: string; password_hash: string; role: 'ADMIN' | 'OPERATOR' } | undefined;

    if (!row || !verifyPassword(password, row.password_hash)) {
      res.status(401).json({ error: 'Invalid operator credentials.' });
      return;
    }
    const token = createSessionToken(row.username, row.role);
    res.json({ token, operator: { sub: row.username, role: row.role } });
  });

  // ---------------- CAMERAS ----------------
  router.get('/cameras', (_req, res) => {
    const rows = db.prepare(`SELECT * FROM cameras ORDER BY created_at DESC`).all() as CameraRecord[];
    res.json({ cameras: rows });
  });

  router.post('/cameras', (req, res) => {
    try {
      const { name, source_type, stream_url } = req.body as {
        name?: string;
        source_type?: CameraRecord['source_type'];
        stream_url?: string;
      };
      if (!name || !name.trim()) {
        res.status(400).json({ error: 'Camera name is required.' });
        return;
      }
      const allowedTypes = ['MOBILE', 'WEBCAM', 'IP', 'RTSP', 'VIDEO_FILE'];
      if (!source_type || !allowedTypes.includes(source_type)) {
        res.status(400).json({ error: 'Valid source_type is required.' });
        return;
      }

      let validatedUrl: string | null = null;
      if (stream_url && stream_url.trim()) {
        validatedUrl = validateStoredStreamUrl(stream_url);
      } else if (source_type === 'IP' || source_type === 'RTSP') {
        res.status(400).json({ error: `Stream URL is required for ${source_type} cameras.` });
        return;
      }

      const id = `cam_${crypto.randomUUID().slice(0, 8)}`;
      const ingestToken = crypto.randomBytes(16).toString('hex');
      const now = new Date().toISOString();

      db.prepare(
        `INSERT INTO cameras (id, name, source_type, stream_url, status, ingest_token, created_at, updated_at)
         VALUES (?, ?, ?, ?, 'DISCONNECTED', ?, ?, ?)`
      ).run(id, name.trim().slice(0, 100), source_type, validatedUrl, ingestToken, now, now);

      logSystem('INFO', 'Cameras', `Registered camera ${name.trim()} (${source_type})`, { id });
      const created = db.prepare(`SELECT * FROM cameras WHERE id = ?`).get(id);
      res.status(201).json({ camera: created });
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : 'Unable to register camera.' });
    }
  });

  router.patch('/cameras/:id', (req, res) => {
    const cam = db.prepare(`SELECT * FROM cameras WHERE id = ?`).get(req.params.id) as CameraRecord | undefined;
    if (!cam) {
      res.status(404).json({ error: 'Camera not found.' });
      return;
    }
    const body = req.body as Partial<CameraRecord>;
    const now = new Date().toISOString();
    const status = body.status || cam.status;
    const isActive = typeof body.is_active === 'number' ? body.is_active : cam.is_active;

    db.prepare(
      `UPDATE cameras SET
        name = ?,
        stream_url = ?,
        status = ?,
        resolution_width = ?,
        resolution_height = ?,
        capture_fps = ?,
        processing_fps = ?,
        inference_fps = ?,
        latency_ms = ?,
        frame_count = ?,
        brightness = ?,
        contrast = ?,
        is_active = ?,
        last_error = ?,
        last_frame_at = ?,
        updated_at = ?
      WHERE id = ?`
    ).run(
      body.name ?? cam.name,
      body.stream_url !== undefined ? body.stream_url : cam.stream_url,
      status,
      body.resolution_width ?? cam.resolution_width,
      body.resolution_height ?? cam.resolution_height,
      body.capture_fps ?? cam.capture_fps,
      body.processing_fps ?? cam.processing_fps,
      body.inference_fps ?? cam.inference_fps,
      body.latency_ms ?? cam.latency_ms,
      body.frame_count ?? cam.frame_count,
      body.brightness ?? cam.brightness,
      body.contrast ?? cam.contrast,
      isActive,
      body.last_error !== undefined ? body.last_error : cam.last_error,
      status === 'CONNECTED' ? now : cam.last_frame_at,
      now,
      cam.id
    );

    wsHub.broadcast({
      type: 'camera_status',
      camera_id: cam.id,
      status,
      message: body.last_error || undefined,
      timestamp: now,
    });

    const updated = db.prepare(`SELECT * FROM cameras WHERE id = ?`).get(cam.id);
    res.json({ camera: updated });
  });

  router.delete('/cameras/:id', (req, res) => {
    const info = db.prepare(`DELETE FROM cameras WHERE id = ?`).run(req.params.id);
    if (info.changes === 0) {
      res.status(404).json({ error: 'Camera not found.' });
      return;
    }
    logSystem('INFO', 'Cameras', `Removed camera ${req.params.id}`);
    res.json({ deleted: true });
  });

  router.post('/cameras/test-connection', async (req, res) => {
    const { source_type, stream_url } = req.body as { source_type?: string; stream_url?: string };
    const cfg = getConfigMap();
    const cvUrl = cfg.cv_service_url || 'http://localhost:8000';

    if (!stream_url) {
      res.status(400).json({ ok: false, error: 'Stream URL is required to test connection.' });
      return;
    }

    // Try Python CV Service first if reachable (required for RTSP & LAN OpenCV VideoCapture)
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 3500);
      const cvRes = await fetch(`${cvUrl.replace(/\/$/, '')}/api/cameras/test`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ source_type, stream_url }),
        signal: controller.signal,
      });
      clearTimeout(timeout);
      if (cvRes.ok) {
        const data = (await cvRes.json()) as { ok: boolean; width?: number; height?: number; fps?: number; message?: string };
        res.json({ ...data, via: 'python_cv_service' });
        return;
      }
    } catch {
      // Python CV Service not reachable from cloud sandbox or not running yet
    }

    if (source_type === 'RTSP') {
      res.json({
        ok: false,
        via: 'browser_limitation',
        error:
          'Browsers cannot decode raw RTSP streams directly, and the Python CV Service is not reachable from this server. Start the local Python CV Service (cv_service/) to decode RTSP via OpenCV.',
      });
      return;
    }

    try {
      const parsed = validateExternalStreamUrl(stream_url);
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 5000);
      const response = await fetch(parsed.toString(), { method: 'GET', signal: controller.signal });
      clearTimeout(timeout);
      const contentType = response.headers.get('content-type') || '';
      if (!response.ok) {
        res.json({ ok: false, error: `Stream endpoint responded with HTTP ${response.status}.` });
        return;
      }
      if (
        !contentType.includes('image/') &&
        !contentType.includes('multipart/x-mixed-replace') &&
        !contentType.includes('video/') &&
        !contentType.includes('application/vnd.apple.mpegurl')
      ) {
        res.json({
          ok: false,
          error: `URL responded with ${contentType || 'unknown content-type'}, not a valid video or MJPEG image stream.`,
        });
        return;
      }
      res.json({
        ok: true,
        via: 'http_probe',
        contentType,
        message: 'Stream endpoint verified and returning media frames.',
      });
    } catch (err) {
      res.json({
        ok: false,
        error:
          err instanceof Error
            ? `${err.message} (Note: if your phone or IP camera is on a private 192.168.x.x Wi-Fi network, use VisionGuard's Mobile Broadcaster link or run the local Python CV Service.)`
            : 'Unable to reach stream URL.',
      });
    }
  });

  router.get('/cameras/:id/proxy-stream', async (req, res) => {
    const cam = db.prepare(`SELECT * FROM cameras WHERE id = ?`).get(req.params.id) as CameraRecord | undefined;
    if (!cam || !cam.stream_url) {
      res.status(404).json({ error: 'Camera stream URL not found.' });
      return;
    }
    try {
      const parsed = validateExternalStreamUrl(cam.stream_url);
      const upstream = await fetch(parsed.toString());
      if (!upstream.ok || !upstream.body) {
        res.status(502).json({ error: `Upstream camera returned HTTP ${upstream.status}.` });
        return;
      }
      const ct = upstream.headers.get('content-type') || 'application/octet-stream';
      res.setHeader('Content-Type', ct);
      res.setHeader('Cache-Control', 'no-store');
      const reader = upstream.body.getReader();
      req.on('close', () => {
        reader.cancel().catch(() => {});
      });
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        res.write(Buffer.from(value));
      }
      res.end();
    } catch (err) {
      res.status(502).json({ error: err instanceof Error ? err.message : 'Stream proxy error.' });
    }
  });

  // ---------------- TELEMETRY & EVENT ENGINE ----------------
  router.post('/telemetry/ingest', (req, res) => {
    const payload = req.body as LiveTelemetryPayload;
    if (!payload || !payload.camera_id) {
      res.status(400).json({ error: 'camera_id is required.' });
      return;
    }
    const now = new Date().toISOString();
    const cam = db.prepare(`SELECT id FROM cameras WHERE id = ?`).get(payload.camera_id);
    if (cam) {
      db.prepare(
        `UPDATE cameras SET
          status = ?,
          resolution_width = ?,
          resolution_height = ?,
          capture_fps = ?,
          processing_fps = ?,
          inference_fps = ?,
          latency_ms = ?,
          frame_count = ?,
          brightness = ?,
          contrast = ?,
          is_active = 1,
          last_frame_at = ?,
          updated_at = ?
        WHERE id = ?`
      ).run(
        payload.status || 'CONNECTED',
        payload.resolution_width || 0,
        payload.resolution_height || 0,
        payload.capture_fps || 0,
        payload.processing_fps || 0,
        payload.inference_fps || 0,
        payload.latency_ms || 0,
        payload.frame_count || 0,
        payload.brightness || 0,
        payload.contrast || 0,
        now,
        now,
        payload.camera_id
      );
    }

    const lastSaved = lastTelemetryPersistByCam.get(payload.camera_id) || 0;
    if (Date.now() - lastSaved >= 3000) {
      lastTelemetryPersistByCam.set(payload.camera_id, Date.now());
      const objTotal = Object.values(payload.object_counts || {}).reduce((acc, v) => acc + v, 0);
      db.prepare(
        `INSERT INTO telemetry_snapshots (camera_id, capture_fps, processing_fps, inference_fps, latency_ms, active_tracks, people_count, object_count, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        payload.camera_id,
        payload.capture_fps || 0,
        payload.processing_fps || 0,
        payload.inference_fps || 0,
        payload.latency_ms || 0,
        payload.active_tracks || 0,
        payload.people_count || 0,
        objTotal,
        now
      );
    }

    wsHub.publishTelemetry(payload);
    res.json({ ok: true });
  });

  router.post('/events/ingest', (req, res) => {
    try {
      const body = req.body as {
        event_type: EventType;
        severity: EventSeverity;
        camera_id?: string | null;
        camera_name?: string | null;
        track_id?: number | null;
        confidence?: number | null;
        description: string;
        reason?: string | null;
        metadata?: Record<string, unknown>;
        snapshot_data_url?: string | null;
        width?: number;
        height?: number;
      };

      if (!body.event_type || !body.severity || !body.description) {
        res.status(400).json({ error: 'event_type, severity, and description are required.' });
        return;
      }

      const cfg = getConfigMap();
      const cooldownSec = Number(cfg.event_cooldown_sec || 12);
      const cutoffIso = new Date(Date.now() - cooldownSec * 1000).toISOString();

      // Deduplication / cooldown check
      const duplicate = db
        .prepare(
          `SELECT id FROM events
           WHERE event_type = ?
             AND COALESCE(camera_id, '') = COALESCE(?, '')
             AND COALESCE(track_id, -1) = COALESCE(?, -1)
             AND created_at >= ?
           LIMIT 1`
        )
        .get(body.event_type, body.camera_id || null, body.track_id ?? null, cutoffIso) as { id: string } | undefined;

      if (duplicate) {
        res.json({ deduplicated: true, existing_event_id: duplicate.id });
        return;
      }

      const now = new Date();
      const nowIso = now.toISOString();
      const eventId = `evt_${now.getTime()}_${crypto.randomBytes(3).toString('hex')}`;

      let evidenceId: string | null = null;
      let relativeEvidencePath: string | null = null;

      // Validate camera existence to respect FK
      let validCameraId: string | null = null;
      if (body.camera_id) {
        const camRow = db.prepare(`SELECT id FROM cameras WHERE id = ?`).get(body.camera_id);
        if (camRow) validCameraId = body.camera_id;
      }

      // Prepare evidence path for HIGH or CRITICAL or explicit snapshot
      if (body.snapshot_data_url && body.snapshot_data_url.startsWith('data:image/')) {
        const match = body.snapshot_data_url.match(/^data:image\/(jpeg|jpg|png);base64,(.+)$/);
        if (match) {
          const ext = match[1] === 'png' ? 'png' : 'jpg';
          const base64Data = match[2];
          const year = String(now.getUTCFullYear());
          const month = String(now.getUTCMonth() + 1).padStart(2, '0');
          evidenceId = `evd_${crypto.randomUUID().slice(0, 8)}`;
          relativeEvidencePath = `${year}/${month}/${eventId}/snapshot.${ext}`;
          const absTarget = resolveConfinedPath(EVIDENCE_ROOT, year, month, eventId, `snapshot.${ext}`);

          // Asynchronous non-blocking evidence write
          fs.promises
            .mkdir(path.dirname(absTarget), { recursive: true })
            .then(() => fs.promises.writeFile(absTarget, Buffer.from(base64Data, 'base64')))
            .catch((err) => {
              logSystem('ERROR', 'EvidenceManager', 'Failed to write evidence snapshot to disk', {
                eventId,
                error: err instanceof Error ? err.message : String(err),
              });
            });
        }
      }

      db.prepare(
        `INSERT INTO events (
          id, event_type, severity, camera_id, camera_name, track_id, confidence,
          description, reason, evidence_id, evidence_path, status, metadata_json, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'NEW', ?, ?)`
      ).run(
        eventId,
        body.event_type,
        body.severity,
        validCameraId,
        body.camera_name || null,
        body.track_id ?? null,
        body.confidence ?? null,
        body.description,
        body.reason || null,
        evidenceId,
        relativeEvidencePath,
        body.metadata ? JSON.stringify(body.metadata) : null,
        nowIso
      );

      if (evidenceId && relativeEvidencePath) {
        db.prepare(
          `INSERT INTO evidence (
            id, event_id, camera_id, camera_name, event_type, severity, track_id, confidence, file_path, width, height, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        ).run(
          evidenceId,
          eventId,
          validCameraId,
          body.camera_name || null,
          body.event_type,
          body.severity,
          body.track_id ?? null,
          body.confidence ?? null,
          relativeEvidencePath,
          body.width || 0,
          body.height || 0,
          nowIso
        );
      }

      const createdEvent = db.prepare(`SELECT * FROM events WHERE id = ?`).get(eventId) as IncidentEventRecord;
      wsHub.publishAlert(createdEvent);
      res.status(201).json({ event: createdEvent });
    } catch (err) {
      logSystem('ERROR', 'EventEngine', 'Failed to ingest event', {
        error: err instanceof Error ? err.message : String(err),
      });
      res.status(500).json({ error: 'Unable to record event.' });
    }
  });

  // ---------------- INCIDENTS ----------------
  router.get('/incidents', (req, res) => {
    const { severity, status, event_type, camera_id, q } = req.query as Record<string, string | undefined>;
    let sql = `SELECT * FROM events WHERE 1=1`;
    const params: unknown[] = [];

    if (severity && severity !== 'ALL') {
      sql += ` AND severity = ?`;
      params.push(severity);
    }
    if (status && status !== 'ALL') {
      sql += ` AND status = ?`;
      params.push(status);
    }
    if (event_type && event_type !== 'ALL') {
      sql += ` AND event_type = ?`;
      params.push(event_type);
    }
    if (camera_id && camera_id !== 'ALL') {
      sql += ` AND camera_id = ?`;
      params.push(camera_id);
    }
    if (q && q.trim()) {
      sql += ` AND (id LIKE ? OR description LIKE ? OR COALESCE(camera_name, '') LIKE ? OR COALESCE(reason, '') LIKE ?)`;
      const term = `%${q.trim()}%`;
      params.push(term, term, term, term);
    }
    sql += ` ORDER BY created_at DESC LIMIT 250`;

    const rows = db.prepare(sql).all(...params) as IncidentEventRecord[];
    res.json({ incidents: rows });
  });

  router.patch('/incidents/:id', (req, res) => {
    const existing = db.prepare(`SELECT * FROM events WHERE id = ?`).get(req.params.id) as IncidentEventRecord | undefined;
    if (!existing) {
      res.status(404).json({ error: 'Incident not found.' });
      return;
    }
    const { status } = req.body as { status?: 'NEW' | 'ACKNOWLEDGED' | 'RESOLVED' };
    if (!status || !['NEW', 'ACKNOWLEDGED', 'RESOLVED'].includes(status)) {
      res.status(400).json({ error: 'Valid status is required.' });
      return;
    }
    const now = new Date().toISOString();
    const ackAt = status === 'ACKNOWLEDGED' ? now : existing.acknowledged_at;
    const resAt = status === 'RESOLVED' ? now : existing.resolved_at;
    db.prepare(`UPDATE events SET status = ?, acknowledged_at = ?, resolved_at = ? WHERE id = ?`).run(
      status,
      ackAt,
      resAt,
      existing.id
    );
    const updated = db.prepare(`SELECT * FROM events WHERE id = ?`).get(existing.id) as IncidentEventRecord;
    wsHub.broadcast({ type: 'incident_updated', event: updated });
    res.json({ incident: updated });
  });

  // ---------------- EVIDENCE VAULT ----------------
  router.get('/evidence', (_req, res) => {
    const rows = db.prepare(`SELECT * FROM evidence ORDER BY created_at DESC LIMIT 200`).all();
    res.json({ evidence: rows });
  });

  router.get('/evidence/file/:id', (req, res) => {
    const row = db.prepare(`SELECT file_path FROM evidence WHERE id = ?`).get(req.params.id) as
      | { file_path: string }
      | undefined;
    if (!row) {
      res.status(404).json({ error: 'Evidence record not found.' });
      return;
    }
    try {
      const absPath = resolveConfinedPath(EVIDENCE_ROOT, row.file_path);
      if (!fs.existsSync(absPath)) {
        res.status(404).json({ error: 'Evidence image file is not yet available on disk.' });
        return;
      }
      res.sendFile(absPath);
    } catch {
      res.status(403).json({ error: 'Invalid evidence file path.' });
    }
  });

  // ---------------- DANGER ZONES ----------------
  router.get('/zones', (req, res) => {
    const cameraId = req.query.camera_id as string | undefined;
    const rows = cameraId
      ? db.prepare(`SELECT * FROM zones WHERE camera_id = ? ORDER BY created_at DESC`).all(cameraId)
      : db.prepare(`SELECT * FROM zones ORDER BY created_at DESC`).all();
    res.json({ zones: rows });
  });

  router.post('/zones', (req, res) => {
    const { camera_id, name, zone_type, polygon, dwell_time_sec, crowd_threshold } = req.body as {
      camera_id?: string;
      name?: string;
      zone_type?: 'SAFE' | 'RESTRICTED' | 'MONITORING';
      polygon?: Array<{ x: number; y: number }>;
      dwell_time_sec?: number;
      crowd_threshold?: number;
    };
    if (!camera_id || !name || !zone_type || !Array.isArray(polygon) || polygon.length < 3) {
      res.status(400).json({ error: 'camera_id, name, zone_type, and polygon with >= 3 points are required.' });
      return;
    }
    const cam = db.prepare(`SELECT id FROM cameras WHERE id = ?`).get(camera_id);
    if (!cam) {
      res.status(404).json({ error: 'Target camera not found.' });
      return;
    }
    for (const pt of polygon) {
      if (typeof pt.x !== 'number' || typeof pt.y !== 'number' || pt.x < 0 || pt.x > 1 || pt.y < 0 || pt.y > 1) {
        res.status(400).json({ error: 'Polygon coordinates must be normalized between 0 and 1.' });
        return;
      }
    }
    const id = `zone_${crypto.randomUUID().slice(0, 8)}`;
    const now = new Date().toISOString();
    db.prepare(
      `INSERT INTO zones (id, camera_id, name, zone_type, polygon_json, dwell_time_sec, crowd_threshold, enabled, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`
    ).run(
      id,
      camera_id,
      name.trim().slice(0, 80),
      zone_type,
      JSON.stringify(polygon),
      Number(dwell_time_sec ?? 5),
      Number(crowd_threshold ?? 5),
      now,
      now
    );
    const created = db.prepare(`SELECT * FROM zones WHERE id = ?`).get(id);
    logSystem('INFO', 'Zones', `Created ${zone_type} zone "${name.trim()}"`, { id, camera_id });
    res.status(201).json({ zone: created });
  });

  router.patch('/zones/:id', (req, res) => {
    const existing = db.prepare(`SELECT * FROM zones WHERE id = ?`).get(req.params.id) as
      | { id: string; enabled: number; dwell_time_sec: number; crowd_threshold: number; name: string }
      | undefined;
    if (!existing) {
      res.status(404).json({ error: 'Zone not found.' });
      return;
    }
    const { enabled, dwell_time_sec, crowd_threshold, name } = req.body as {
      enabled?: number;
      dwell_time_sec?: number;
      crowd_threshold?: number;
      name?: string;
    };
    const now = new Date().toISOString();
    db.prepare(
      `UPDATE zones SET name = ?, enabled = ?, dwell_time_sec = ?, crowd_threshold = ?, updated_at = ? WHERE id = ?`
    ).run(
      name ?? existing.name,
      enabled ?? existing.enabled,
      dwell_time_sec ?? existing.dwell_time_sec,
      crowd_threshold ?? existing.crowd_threshold,
      now,
      existing.id
    );
    const updated = db.prepare(`SELECT * FROM zones WHERE id = ?`).get(existing.id);
    res.json({ zone: updated });
  });

  router.delete('/zones/:id', (req, res) => {
    const info = db.prepare(`DELETE FROM zones WHERE id = ?`).run(req.params.id);
    if (info.changes === 0) {
      res.status(404).json({ error: 'Zone not found.' });
      return;
    }
    res.json({ deleted: true });
  });

  // ---------------- IDENTITIES & FACE RECOGNITION ----------------
  router.get('/identities', (_req, res) => {
    const rows = db
      .prepare(
        `SELECT i.*,
          (SELECT COUNT(*) FROM face_embeddings fe WHERE fe.identity_id = i.id) AS embedding_count,
          (SELECT fe.id FROM face_embeddings fe WHERE fe.identity_id = i.id ORDER BY fe.created_at DESC LIMIT 1) AS sample_embedding_id
         FROM identities i ORDER BY i.created_at DESC`
      )
      .all() as Array<Record<string, unknown>>;
    const formatted = rows.map((r) => ({
      ...r,
      sample_image_path: r.sample_embedding_id ? `/api/identities/image/${r.sample_embedding_id}` : null,
    }));
    res.json({ identities: formatted });
  });

  router.post('/identities', imageUpload.array('images', 10), async (req, res) => {
    try {
      const { name, role_label, notes, similarity_threshold } = req.body as {
        name?: string;
        role_label?: string;
        notes?: string;
        similarity_threshold?: string;
      };
      if (!name || !name.trim()) {
        res.status(400).json({ error: 'Identity name is required.' });
        return;
      }
      const files = (req.files as Express.Multer.File[]) || [];
      if (files.length === 0) {
        res.status(400).json({ error: 'At least one reference face image is required.' });
        return;
      }

      const id = `idn_${crypto.randomUUID().slice(0, 8)}`;
      const now = new Date().toISOString();
      const threshold = Number(similarity_threshold ?? 0.62);

      db.prepare(
        `INSERT INTO identities (id, name, role_label, notes, enabled, similarity_threshold, created_at, updated_at)
         VALUES (?, ?, ?, ?, 1, ?, ?, ?)`
      ).run(id, name.trim().slice(0, 80), (role_label || 'Authorized Personnel').trim(), notes || null, threshold, now, now);

      const cfg = getConfigMap();
      const cvUrl = (cfg.cv_service_url || 'http://localhost:8000').replace(/\/$/, '');
      let pythonEmbeddingsExtracted = 0;

      for (const file of files) {
        const embId = `emb_${crypto.randomUUID().slice(0, 8)}`;
        const ext = path.extname(file.originalname).toLowerCase() || '.jpg';
        const relPath = `${id}/${embId}${ext}`;
        const absPath = resolveConfinedPath(IDENTITY_UPLOADS_ROOT, relPath);
        await fs.promises.mkdir(path.dirname(absPath), { recursive: true });
        await fs.promises.writeFile(absPath, file.buffer);

        let embeddingVec: number[] | null = null;
        let modelName = 'Pending-Python-ArcFace';
        let qualityScore = 0;

        // Try Python CV Service ArcFace embedding extraction
        try {
          const form = new FormData();
          form.append('image', new Blob([new Uint8Array(file.buffer)], { type: file.mimetype }), file.originalname);
          const controller = new AbortController();
          const t = setTimeout(() => controller.abort(), 5000);
          const cvRes = await fetch(`${cvUrl}/api/face/extract-embedding`, {
            method: 'POST',
            body: form,
            signal: controller.signal,
          });
          clearTimeout(t);
          if (cvRes.ok) {
            const parsed = (await cvRes.json()) as {
              embedding?: number[];
              model_name?: string;
              quality_score?: number;
            };
            if (Array.isArray(parsed.embedding) && parsed.embedding.length > 0) {
              embeddingVec = parsed.embedding;
              modelName = parsed.model_name || 'ArcFace-InsightFace';
              qualityScore = parsed.quality_score || 0.9;
              pythonEmbeddingsExtracted++;
            }
          }
        } catch {
          // Python CV service offline; image stored for enrollment sync
        }

        db.prepare(
          `INSERT INTO face_embeddings (id, identity_id, image_path, embedding_json, model_name, quality_score, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)`
        ).run(id ? embId : embId, id, relPath, JSON.stringify(embeddingVec || []), modelName, qualityScore, now);
      }

      logSystem('INFO', 'Identities', `Enrolled identity ${name.trim()} with ${files.length} reference image(s)`, {
        id,
        pythonEmbeddingsExtracted,
      });

      const created = db.prepare(`SELECT * FROM identities WHERE id = ?`).get(id);
      res.status(201).json({
        identity: created,
        embeddings_extracted: pythonEmbeddingsExtracted,
        message:
          pythonEmbeddingsExtracted > 0
            ? `Enrolled with ${pythonEmbeddingsExtracted} ArcFace embeddings.`
            : 'Reference images saved. Start the Python CV Service to compute ArcFace face embeddings.',
      });
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : 'Unable to enroll identity.' });
    }
  });

  router.patch('/identities/:id', (req, res) => {
    const existing = db.prepare(`SELECT * FROM identities WHERE id = ?`).get(req.params.id) as
      | { id: string; enabled: number; similarity_threshold: number }
      | undefined;
    if (!existing) {
      res.status(404).json({ error: 'Identity not found.' });
      return;
    }
    const { enabled, similarity_threshold } = req.body as { enabled?: number; similarity_threshold?: number };
    const now = new Date().toISOString();
    db.prepare(`UPDATE identities SET enabled = ?, similarity_threshold = ?, updated_at = ? WHERE id = ?`).run(
      enabled ?? existing.enabled,
      similarity_threshold ?? existing.similarity_threshold,
      now,
      existing.id
    );
    const updated = db.prepare(`SELECT * FROM identities WHERE id = ?`).get(existing.id);
    res.json({ identity: updated });
  });

  router.delete('/identities/:id', (req, res) => {
    const info = db.prepare(`DELETE FROM identities WHERE id = ?`).run(req.params.id);
    if (info.changes === 0) {
      res.status(404).json({ error: 'Identity not found.' });
      return;
    }
    res.json({ deleted: true });
  });

  router.get('/identities/image/:embeddingId', (req, res) => {
    const row = db.prepare(`SELECT image_path FROM face_embeddings WHERE id = ?`).get(req.params.embeddingId) as
      | { image_path: string }
      | undefined;
    if (!row) {
      res.status(404).json({ error: 'Image not found.' });
      return;
    }
    try {
      const absPath = resolveConfinedPath(IDENTITY_UPLOADS_ROOT, row.image_path);
      if (!fs.existsSync(absPath)) {
        res.status(404).json({ error: 'Image file missing on disk.' });
        return;
      }
      res.sendFile(absPath);
    } catch {
      res.status(403).json({ error: 'Invalid path.' });
    }
  });

  router.post('/identities/evaluate', async (_req, res) => {
    const cfg = getConfigMap();
    const cvUrl = (cfg.cv_service_url || 'http://localhost:8000').replace(/\/$/, '');
    try {
      const controller = new AbortController();
      const t = setTimeout(() => controller.abort(), 5000);
      const cvRes = await fetch(`${cvUrl}/api/face/evaluate`, { method: 'POST', signal: controller.signal });
      clearTimeout(t);
      if (cvRes.ok) {
        res.json(await cvRes.json());
        return;
      }
      res.status(502).json({ error: 'Python CV Service failed to run evaluation.' });
    } catch {
      res.status(503).json({
        error:
          'Evaluation metrics (Accuracy, Precision, Recall, FAR, FRR) require a labeled evaluation dataset and the running Python CV Service. No metrics are fabricated.',
      });
    }
  });

  // ---------------- CAMERA CALIBRATION ----------------
  router.get('/calibration', (_req, res) => {
    const rows = db.prepare(`SELECT * FROM calibrations ORDER BY created_at DESC`).all();
    res.json({ calibrations: rows });
  });

  router.post('/calibration/:cameraId/upload', imageUpload.array('images', 25), async (req, res) => {
    const cam = db.prepare(`SELECT * FROM cameras WHERE id = ?`).get(req.params.cameraId) as CameraRecord | undefined;
    if (!cam) {
      res.status(404).json({ error: 'Camera not found.' });
      return;
    }
    const files = (req.files as Express.Multer.File[]) || [];
    if (files.length < 3) {
      res.status(400).json({ error: 'Upload at least 3 chessboard images for camera calibration.' });
      return;
    }

    const cols = Number(req.body.chessboard_cols || 9);
    const rows = Number(req.body.chessboard_rows || 6);
    const squareSize = Number(req.body.square_size_mm || 25);

    const calId = `cal_${crypto.randomUUID().slice(0, 8)}`;
    const now = new Date().toISOString();

    for (let i = 0; i < files.length; i++) {
      const ext = path.extname(files[i].originalname).toLowerCase() || '.jpg';
      const absPath = resolveConfinedPath(CALIBRATION_UPLOADS_ROOT, cam.id, `${calId}_${i}${ext}`);
      await fs.promises.mkdir(path.dirname(absPath), { recursive: true });
      await fs.promises.writeFile(absPath, files[i].buffer);
    }

    const cfg = getConfigMap();
    const cvUrl = (cfg.cv_service_url || 'http://localhost:8000').replace(/\/$/, '');

    try {
      const form = new FormData();
      form.append('camera_id', cam.id);
      form.append('chessboard_cols', String(cols));
      form.append('chessboard_rows', String(rows));
      form.append('square_size_mm', String(squareSize));
      for (const file of files) {
        form.append('images', new Blob([new Uint8Array(file.buffer)], { type: file.mimetype }), file.originalname);
      }
      const controller = new AbortController();
      const t = setTimeout(() => controller.abort(), 15000);
      const cvRes = await fetch(`${cvUrl}/api/calibration/run`, {
        method: 'POST',
        body: form,
        signal: controller.signal,
      });
      clearTimeout(t);
      if (cvRes.ok) {
        const result = (await cvRes.json()) as {
          status: 'CALIBRATED' | 'CALIBRATION_FAILED';
          valid_image_count: number;
          camera_matrix?: number[][];
          dist_coeffs?: number[];
          reprojection_error?: number;
          error_message?: string;
        };
        db.prepare(
          `INSERT INTO calibrations (
            id, camera_id, status, chessboard_cols, chessboard_rows, square_size_mm,
            image_count, valid_image_count, camera_matrix_json, dist_coeffs_json,
            reprojection_error, calibrated_at, error_message, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        ).run(
          calId,
          cam.id,
          result.status,
          cols,
          rows,
          squareSize,
          files.length,
          result.valid_image_count || 0,
          result.camera_matrix ? JSON.stringify(result.camera_matrix) : null,
          result.dist_coeffs ? JSON.stringify(result.dist_coeffs) : null,
          result.reprojection_error ?? null,
          result.status === 'CALIBRATED' ? now : null,
          result.error_message || null,
          now
        );
        const created = db.prepare(`SELECT * FROM calibrations WHERE id = ?`).get(calId);
        res.status(201).json({ calibration: created });
        return;
      }
    } catch {
      // Python CV Service unavailable
    }

    db.prepare(
      `INSERT INTO calibrations (
        id, camera_id, status, chessboard_cols, chessboard_rows, square_size_mm,
        image_count, valid_image_count, error_message, created_at
      ) VALUES (?, ?, 'NOT_CALIBRATED', ?, ?, ?, ?, 0, ?, ?)`
    ).run(
      calId,
      cam.id,
      cols,
      rows,
      squareSize,
      files.length,
      'Chessboard images stored. Start the local Python OpenCV CV Service to compute camera matrix, distortion coefficients, and reprojection error.',
      now
    );

    const created = db.prepare(`SELECT * FROM calibrations WHERE id = ?`).get(calId);
    res.status(202).json({ calibration: created });
  });

  // ---------------- DEMO VIDEOS ----------------
  router.get('/demo/videos', (_req, res) => {
    const collect = (dir: string, source: 'sample_data' | 'uploaded') => {
      if (!fs.existsSync(dir)) return [];
      return fs
        .readdirSync(dir)
        .filter((f) => /\.(mp4|webm|mov|avi|mkv)$/i.test(f))
        .map((filename) => {
          const stat = fs.statSync(path.join(dir, filename));
          return {
            filename,
            source,
            size_bytes: stat.size,
            stream_url: `/api/demo/stream/${source}/${encodeURIComponent(filename)}`,
            created_at: stat.mtime.toISOString(),
          };
        });
    };
    res.json({
      videos: [...collect(UPLOADS_ROOT, 'uploaded'), ...collect(SAMPLE_VIDEOS_ROOT, 'sample_data')],
    });
  });

  router.post('/demo/upload', videoUpload.single('video'), (req, res) => {
    if (!req.file) {
      res.status(400).json({ error: 'Video file is required.' });
      return;
    }
    logSystem('INFO', 'DemoMode', `Uploaded demonstration video: ${req.file.filename}`, {
      size: req.file.size,
    });
    res.status(201).json({
      video: {
        filename: req.file.filename,
        source: 'uploaded',
        size_bytes: req.file.size,
        stream_url: `/api/demo/stream/uploaded/${encodeURIComponent(req.file.filename)}`,
        created_at: new Date().toISOString(),
      },
    });
  });

  router.get('/demo/stream/:source/:filename', (req, res) => {
    const baseDir = req.params.source === 'sample_data' ? SAMPLE_VIDEOS_ROOT : UPLOADS_ROOT;
    try {
      const filePath = resolveConfinedPath(baseDir, req.params.filename);
      if (!fs.existsSync(filePath)) {
        res.status(404).json({ error: 'Video file not found.' });
        return;
      }
      const stat = fs.statSync(filePath);
      const total = stat.size;
      const range = req.headers.range;
      const ext = path.extname(filePath).toLowerCase();
      const mime = ext === '.webm' ? 'video/webm' : ext === '.mov' ? 'video/quicktime' : 'video/mp4';

      if (range) {
        const parts = range.replace(/bytes=/, '').split('-');
        const start = parseInt(parts[0], 10);
        const end = parts[1] ? parseInt(parts[1], 10) : total - 1;
        const chunksize = end - start + 1;
        res.writeHead(206, {
          'Content-Range': `bytes ${start}-${end}/${total}`,
          'Accept-Ranges': 'bytes',
          'Content-Length': chunksize,
          'Content-Type': mime,
        });
        fs.createReadStream(filePath, { start, end }).pipe(res);
      } else {
        res.writeHead(200, {
          'Content-Length': total,
          'Content-Type': mime,
        });
        fs.createReadStream(filePath).pipe(res);
      }
    } catch {
      res.status(403).json({ error: 'Invalid video path.' });
    }
  });

  // ---------------- ANALYTICS ----------------
  router.get('/analytics', (_req, res) => {
    const eventsByType = db
      .prepare(`SELECT event_type AS name, COUNT(*) AS value FROM events GROUP BY event_type ORDER BY value DESC`)
      .all();
    const eventsBySeverity = db
      .prepare(`SELECT severity AS name, COUNT(*) AS value FROM events GROUP BY severity`)
      .all();
    const eventsOverTime = db
      .prepare(
        `SELECT substr(created_at, 1, 16) AS bucket, COUNT(*) AS count
         FROM events
         GROUP BY bucket
         ORDER BY bucket ASC
         LIMIT 60`
      )
      .all();
    const telemetrySeries = db
      .prepare(
        `SELECT substr(created_at, 12, 8) AS time, capture_fps, processing_fps, inference_fps, latency_ms, people_count, object_count, active_tracks
         FROM telemetry_snapshots
         ORDER BY id DESC
         LIMIT 40`
      )
      .all()
      .reverse();

    const zoneViolations = db
      .prepare(
        `SELECT COALESCE(camera_name, 'Unassigned') AS camera, COUNT(*) AS count
         FROM events
         WHERE event_type IN ('DANGER_ZONE_INTRUSION', 'LOITERING_DETECTED', 'CROWDING')
         GROUP BY camera`
      )
      .all();

    const todayPrefix = new Date().toISOString().slice(0, 10);
    const summary = {
      total_events: (db.prepare(`SELECT COUNT(*) AS c FROM events`).get() as { c: number }).c,
      alerts_today: (
        db.prepare(`SELECT COUNT(*) AS c FROM events WHERE created_at LIKE ?`).get(`${todayPrefix}%`) as { c: number }
      ).c,
      critical_events: (
        db.prepare(`SELECT COUNT(*) AS c FROM events WHERE severity IN ('HIGH','CRITICAL') AND status != 'RESOLVED'`).get() as {
          c: number;
        }
      ).c,
      evidence_count: (db.prepare(`SELECT COUNT(*) AS c FROM evidence`).get() as { c: number }).c,
      active_cameras: (
        db.prepare(`SELECT COUNT(*) AS c FROM cameras WHERE status = 'CONNECTED'`).get() as { c: number }
      ).c,
    };

    res.json({
      summary,
      eventsByType,
      eventsBySeverity,
      eventsOverTime,
      telemetrySeries,
      zoneViolations,
    });
  });

  // ---------------- SYSTEM HEALTH & CONFIG ----------------
  router.get('/health', async (_req, res) => {
    const cfg = getConfigMap();
    const cvUrl = (cfg.cv_service_url || 'http://localhost:8000').replace(/\/$/, '');

    const latestRes = wsHub.getLatestResourceSample();
    const ramPct = latestRes.ram_usage_pct;
    const cpuPct = latestRes.cpu_usage_pct;

    let cvStatus: HealthState = 'WARNING';
    let yoloStatus = cfg.browser_edge_cv_enabled === 'true' ? 'Browser Edge (TF.js COCO-SSD Ready)' : 'Python CV Offline';
    let faceStatus = 'Awaiting Python CV Service (ArcFace)';
    let gpuStatus = 'CPU / WebGL Browser Acceleration';

    try {
      const controller = new AbortController();
      const t = setTimeout(() => controller.abort(), 1500);
      const cvRes = await fetch(`${cvUrl}/health`, { signal: controller.signal });
      clearTimeout(t);
      if (cvRes.ok) {
        const cvHealth = (await cvRes.json()) as {
          yolo_loaded?: boolean;
          yolo_model?: string;
          face_loaded?: boolean;
          gpu_available?: boolean;
          gpu_name?: string;
        };
        cvStatus = 'HEALTHY';
        yoloStatus = cvHealth.yolo_loaded ? `Python ${cvHealth.yolo_model || 'YOLOv8n'} Loaded` : 'YOLO Weights Missing';
        faceStatus = cvHealth.face_loaded ? 'ArcFace Ready' : 'Face Model Not Loaded';
        gpuStatus = cvHealth.gpu_available ? cvHealth.gpu_name || 'CUDA GPU Active' : 'CPU Mode (Intel/x86)';
      }
    } catch {
      cvStatus = 'WARNING';
    }

    let dbStatus: HealthState = 'HEALTHY';
    try {
      db.prepare(`SELECT 1`).get();
    } catch {
      dbStatus = 'CRITICAL';
    }

    const activeCameras = (
      db.prepare(`SELECT COUNT(*) AS c FROM cameras WHERE status = 'CONNECTED'`).get() as { c: number }
    ).c;

    const overallState: HealthState =
      dbStatus === 'CRITICAL' ? 'CRITICAL' : ramPct > 92 || cpuPct > 92 ? 'WARNING' : 'HEALTHY';

    const logs = db.prepare(`SELECT * FROM system_logs ORDER BY id DESC LIMIT 40`).all();

    res.json({
      health: {
        overall_state: overallState,
        cpu_usage_pct: cpuPct,
        ram_used_mb: latestRes.ram_used_mb,
        ram_total_mb: latestRes.ram_total_mb,
        ram_usage_pct: ramPct,
        gpu_status: gpuStatus,
        websocket_clients: wsHub.getLiveClientCount(),
        database_status: dbStatus,
        cv_service_status: cvStatus,
        cv_service_url: cvUrl,
        yolo_model_status: yoloStatus,
        face_model_status: faceStatus,
        uptime_sec: Math.round((Date.now() - SERVER_START_MS) / 1000),
        active_cameras: activeCameras,
      },
      history: wsHub.getResourceHistory(),
      logs,
    });
  });

  router.get('/config', (_req, res) => {
    const raw = getConfigMap();
    res.json({
      config: {
        yolo_confidence: Number(raw.yolo_confidence ?? 0.45),
        yolo_imgsz: Number(raw.yolo_imgsz ?? 640),
        inference_interval_ms: Number(raw.inference_interval_ms ?? 120),
        crowd_normal_max: Number(raw.crowd_normal_max ?? 4),
        crowd_elevated_max: Number(raw.crowd_elevated_max ?? 9),
        face_similarity_threshold: Number(raw.face_similarity_threshold ?? 0.62),
        event_cooldown_sec: Number(raw.event_cooldown_sec ?? 12),
        cv_service_url: raw.cv_service_url ?? 'http://localhost:8000',
        browser_edge_cv_enabled: raw.browser_edge_cv_enabled !== 'false',
      },
    });
  });

  router.patch('/config', (req, res) => {
    const body = req.body as Record<string, unknown>;
    const allowedKeys = [
      'yolo_confidence',
      'yolo_imgsz',
      'inference_interval_ms',
      'crowd_normal_max',
      'crowd_elevated_max',
      'face_similarity_threshold',
      'event_cooldown_sec',
      'cv_service_url',
      'browser_edge_cv_enabled',
    ];
    const now = new Date().toISOString();
    const upsert = db.prepare(
      `INSERT INTO cv_config (key, value, updated_at) VALUES (?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
    );
    for (const key of allowedKeys) {
      if (body[key] !== undefined) {
        upsert.run(key, String(body[key]), now);
      }
    }
    logSystem('INFO', 'Config', 'Updated CV pipeline configuration');
    res.json({ ok: true });
  });

  // ---------------- PROJECT ZIP EXPORT ----------------
  router.get('/export/zip', async (_req, res) => {
    try {
      const rootDir = process.cwd();
      const zip = new JSZip();
      const folder = zip.folder('visionguard');
      if (!folder) {
        res.status(500).json({ error: 'Failed to initialize ZIP archive.' });
        return;
      }

      const excludeDirs = new Set([
        'node_modules',
        'dist',
        'data',
        'evidence',
        '.git',
        '.venv',
        '__pycache__',
      ]);
      const excludeFiles = new Set(['.env', 'visionguard-capstone.zip']);

      const walk = (dir: string) => {
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        for (const entry of entries) {
          if (excludeDirs.has(entry.name)) continue;
          const full = path.join(dir, entry.name);
          if (entry.isDirectory()) {
            walk(full);
          } else if (entry.isFile()) {
            if (
              excludeFiles.has(entry.name) ||
              entry.name.endsWith('.db') ||
              entry.name.endsWith('.db-wal') ||
              entry.name.endsWith('.db-shm')
            ) {
              continue;
            }
            const rel = path.relative(rootDir, full).replace(/\\/g, '/');
            folder.file(rel, fs.readFileSync(full));
          }
        }
      };

      walk(rootDir);
      const buffer = await zip.generateAsync({
        type: 'nodebuffer',
        compression: 'DEFLATE',
        compressionOptions: { level: 6 },
      });

      res.setHeader('Content-Type', 'application/zip');
      res.setHeader('Content-Disposition', 'attachment; filename="visionguard-capstone.zip"');
      res.setHeader('Content-Length', String(buffer.length));
      res.send(buffer);
    } catch {
      res.status(500).json({ error: 'Unable to generate project ZIP archive.' });
    }
  });

  return router;
}
