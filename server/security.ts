import crypto from 'node:crypto';
import path from 'node:path';
import type { NextFunction, Request, Response } from 'express';

const SESSION_SIGNING_KEY =
  process.env.VISIONGUARD_SESSION_SECRET && process.env.VISIONGUARD_SESSION_SECRET.length >= 16
    ? process.env.VISIONGUARD_SESSION_SECRET
    : crypto.randomBytes(32).toString('hex');

export const DATA_ROOT = path.resolve(process.cwd(), 'data');
export const EVIDENCE_ROOT = path.resolve(process.cwd(), 'evidence');
export const SAMPLE_VIDEOS_ROOT = path.resolve(process.cwd(), 'sample_data', 'videos');
export const UPLOADS_ROOT = path.resolve(process.cwd(), 'data', 'uploads');
export const CALIBRATION_UPLOADS_ROOT = path.resolve(process.cwd(), 'data', 'calibration');
export const IDENTITY_UPLOADS_ROOT = path.resolve(process.cwd(), 'data', 'identities');

/**
 * Confines any dynamically resolved path strictly inside baseDir.
 */
export function resolveConfinedPath(baseDir: string, ...segments: string[]): string {
  const resolvedBase = path.resolve(baseDir);
  const cleanedSegments = segments.map((seg) => seg.replace(/^[/\\]+/, ''));
  const target = path.resolve(resolvedBase, ...cleanedSegments);
  if (target !== resolvedBase && !target.startsWith(resolvedBase + path.sep)) {
    throw new Error('Path traversal attempt rejected.');
  }
  return target;
}

/**
 * Validates outbound HTTP/HTTPS stream URLs against SSRF targets.
 */
export function validateExternalStreamUrl(rawUrl: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new Error('Invalid stream URL format.');
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('Only http:// and https:// URLs can be tested directly by the Node.js proxy.');
  }

  const host = parsed.hostname.toLowerCase();
  if (
    host === 'localhost' ||
    host === '127.0.0.1' ||
    host === '0.0.0.0' ||
    host === '::1' ||
    host === '169.254.169.254' ||
    host.startsWith('169.254.') ||
    host.endsWith('.internal') ||
    host.endsWith('.local')
  ) {
    throw new Error('Loopback and link-local metadata addresses are blocked for server-side HTTP fetches.');
  }

  return parsed;
}

/**
 * Validates any stream URL format stored in the database (including rtsp:// and local LAN hints
 * that will be consumed by the external Python CV Service or browser).
 */
export function validateStoredStreamUrl(rawUrl: string): string {
  const trimmed = rawUrl.trim();
  if (!trimmed || trimmed.length > 1024) {
    throw new Error('Stream URL must be between 1 and 1024 characters.');
  }
  const lower = trimmed.toLowerCase();
  if (
    !lower.startsWith('http://') &&
    !lower.startsWith('https://') &&
    !lower.startsWith('rtsp://') &&
    !lower.startsWith('rtsps://') &&
    !lower.startsWith('webcam://') &&
    !lower.startsWith('mobile://')
  ) {
    throw new Error('Unsupported stream protocol. Use http://, https://, rtsp://, webcam://, or mobile://.');
  }
  return trimmed;
}

export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  const derived = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${derived}`;
}

export function verifyPassword(password: string, storedHash: string): boolean {
  const parts = storedHash.split(':');
  if (parts.length !== 2) return false;
  const [salt, originalHex] = parts;
  const derived = crypto.scryptSync(password, salt, 64);
  const original = Buffer.from(originalHex, 'hex');
  if (derived.length !== original.length) return false;
  return crypto.timingSafeEqual(derived, original);
}

export interface SessionPayload {
  sub: string;
  role: 'ADMIN' | 'OPERATOR';
  exp: number;
}

export function createSessionToken(username: string, role: 'ADMIN' | 'OPERATOR'): string {
  const payload: SessionPayload = {
    sub: username,
    role,
    exp: Date.now() + 12 * 60 * 60 * 1000,
  };
  const encoded = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  const sig = crypto
    .createHmac('sha256', SESSION_SIGNING_KEY)
    .update(encoded)
    .digest('base64url');
  return `${encoded}.${sig}`;
}

export function verifySessionToken(token: string): SessionPayload | null {
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [encoded, sig] = parts;
  const expectedSig = crypto
    .createHmac('sha256', SESSION_SIGNING_KEY)
    .update(encoded)
    .digest('base64url');
  const sigBuf = Buffer.from(sig);
  const expBuf = Buffer.from(expectedSig);
  if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) {
    return null;
  }
  try {
    const parsed = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')) as SessionPayload;
    if (!parsed.exp || parsed.exp < Date.now()) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function extractBearerToken(req: Request): string | null {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) return null;
  return header.slice(7).trim() || null;
}

export function attachOptionalOperator(req: Request, _res: Response, next: NextFunction): void {
  const token = extractBearerToken(req);
  if (token) {
    const session = verifySessionToken(token);
    if (session) {
      (req as Request & { operator?: SessionPayload }).operator = session;
    }
  }
  next();
}
