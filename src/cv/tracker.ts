export interface RawDetection {
  class_name: string;
  confidence: number;
  bbox: [number, number, number, number]; // normalized [x1, y1, x2, y2]
}

export interface TrackedObject {
  track_id: number;
  class_name: string;
  confidence: number;
  bbox: [number, number, number, number];
  center: [number, number];
  velocity_px_per_sec: number;
  displacement_px: number;
  trajectory: [number, number][];
}

interface InternalTrack {
  id: number;
  class_name: string;
  confidence: number;
  bbox: [number, number, number, number];
  center: [number, number];
  lastSeenMs: number;
  missedFrames: number;
  displacement_px: number;
  velocity_px_per_sec: number;
  trajectory: [number, number][];
}

function computeIoU(a: [number, number, number, number], b: [number, number, number, number]): number {
  const xA = Math.max(a[0], b[0]);
  const yA = Math.max(a[1], b[1]);
  const xB = Math.min(a[2], b[2]);
  const yB = Math.min(a[3], b[3]);
  const interArea = Math.max(0, xB - xA) * Math.max(0, yB - yA);
  if (interArea <= 0) return 0;
  const areaA = Math.max(1e-6, (a[2] - a[0]) * (a[3] - a[1]));
  const areaB = Math.max(1e-6, (b[2] - b[0]) * (b[3] - b[1]));
  return interArea / (areaA + areaB - interArea);
}

export class MultiObjectTracker {
  private nextId = 1;
  private tracks: Map<number, InternalTrack> = new Map();
  private readonly maxMissedFrames = 12;

  public reset(): void {
    this.tracks.clear();
    this.nextId = 1;
  }

  public update(
    detections: RawDetection[],
    frameWidth: number,
    frameHeight: number,
    nowMs: number = performance.now()
  ): TrackedObject[] {
    const matchedTrackIds = new Set<number>();
    const matchedDetIndices = new Set<number>();

    // Greedy IoU + centroid distance matching (ByteTrack-style high-confidence association)
    const pairs: Array<{ trackId: number; detIdx: number; score: number }> = [];

    for (const [trackId, track] of this.tracks.entries()) {
      for (let i = 0; i < detections.length; i++) {
        const det = detections[i];
        if (det.class_name !== track.class_name) continue;
        const iou = computeIoU(track.bbox, det.bbox);
        const dcx = (det.bbox[0] + det.bbox[2]) / 2;
        const dcy = (det.bbox[1] + det.bbox[3]) / 2;
        const dist = Math.hypot(dcx - track.center[0], dcy - track.center[1]);
        if (iou >= 0.15 || dist <= 0.16) {
          pairs.push({ trackId, detIdx: i, score: iou * 2.0 - dist });
        }
      }
    }

    pairs.sort((a, b) => b.score - a.score);

    for (const p of pairs) {
      if (matchedTrackIds.has(p.trackId) || matchedDetIndices.has(p.detIdx)) continue;
      matchedTrackIds.add(p.trackId);
      matchedDetIndices.add(p.detIdx);

      const track = this.tracks.get(p.trackId)!;
      const det = detections[p.detIdx];
      const ncx = (det.bbox[0] + det.bbox[2]) / 2;
      const ncy = (det.bbox[1] + det.bbox[3]) / 2;

      const dxPx = (ncx - track.center[0]) * frameWidth;
      const dyPx = (ncy - track.center[1]) * frameHeight;
      const displacementPx = Math.hypot(dxPx, dyPx);
      const dtSec = Math.max(0.01, (nowMs - track.lastSeenMs) / 1000);
      const velocityPx = displacementPx / dtSec;

      track.bbox = det.bbox;
      track.confidence = det.confidence;
      track.center = [ncx, ncy];
      track.lastSeenMs = nowMs;
      track.missedFrames = 0;
      track.displacement_px = Number(displacementPx.toFixed(2));
      track.velocity_px_per_sec = Number(velocityPx.toFixed(1));
      track.trajectory.push([Number(ncx.toFixed(4)), Number(ncy.toFixed(4))]);
      if (track.trajectory.length > 30) {
        track.trajectory.shift();
      }
    }

    // Age unmatched tracks
    for (const [trackId, track] of this.tracks.entries()) {
      if (!matchedTrackIds.has(trackId)) {
        track.missedFrames += 1;
        if (track.missedFrames > this.maxMissedFrames) {
          this.tracks.delete(trackId);
        }
      }
    }

    // Create new tracks for unmatched detections
    for (let i = 0; i < detections.length; i++) {
      if (matchedDetIndices.has(i)) continue;
      const det = detections[i];
      const ncx = (det.bbox[0] + det.bbox[2]) / 2;
      const ncy = (det.bbox[1] + det.bbox[3]) / 2;
      const id = this.nextId++;
      this.tracks.set(id, {
        id,
        class_name: det.class_name,
        confidence: det.confidence,
        bbox: det.bbox,
        center: [ncx, ncy],
        lastSeenMs: nowMs,
        missedFrames: 0,
        displacement_px: 0,
        velocity_px_per_sec: 0,
        trajectory: [[Number(ncx.toFixed(4)), Number(ncy.toFixed(4))]],
      });
    }

    const active: TrackedObject[] = [];
    for (const track of this.tracks.values()) {
      if (track.missedFrames === 0) {
        active.push({
          track_id: track.id,
          class_name: track.class_name,
          confidence: track.confidence,
          bbox: track.bbox,
          center: track.center,
          displacement_px: track.displacement_px,
          velocity_px_per_sec: track.velocity_px_per_sec,
          trajectory: [...track.trajectory],
        });
      }
    }
    return active;
  }
}
