import type {
  DetectionBox,
  EventSeverity,
  EventType,
  NormalizedPoint,
  ZoneRecord,
} from '../types/visionguard.ts';

export interface CandidateEvent {
  event_type: EventType;
  severity: EventSeverity;
  camera_id: string;
  camera_name: string;
  track_id: number | null;
  confidence: number | null;
  description: string;
  reason: string;
}

export function pointInPolygon(x: number, y: number, polygon: NormalizedPoint[]): boolean {
  if (polygon.length < 3) return false;
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i].x;
    const yi = polygon[i].y;
    const xj = polygon[j].x;
    const yj = polygon[j].y;
    const intersect = yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi || 1e-9) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

export class BrowserZoneActivityEngine {
  private zoneEntries = new Map<string, number>();
  private stationaryStart = new Map<string, number>();

  public reset(): void {
    this.zoneEntries.clear();
    this.stationaryStart.clear();
  }

  public analyze(
    cameraId: string,
    cameraName: string,
    detections: DetectionBox[],
    zones: ZoneRecord[],
    crowdNormalMax: number,
    crowdElevatedMax: number
  ): {
    events: CandidateEvent[];
    crowdLevel: 'NORMAL' | 'ELEVATED' | 'HIGH';
  } {
    const now = Date.now();
    const events: CandidateEvent[] = [];
    const people = detections.filter((d) => d.class_name === 'person');
    const peopleCount = people.length;

    const crowdLevel: 'NORMAL' | 'ELEVATED' | 'HIGH' =
      peopleCount <= crowdNormalMax ? 'NORMAL' : peopleCount <= crowdElevatedMax ? 'ELEVATED' : 'HIGH';

    const activeZoneKeys = new Set<string>();

    for (const zone of zones) {
      if (!zone.enabled) continue;
      let polygon: NormalizedPoint[] = [];
      try {
        polygon = zone.polygon || (JSON.parse(zone.polygon_json) as NormalizedPoint[]);
      } catch {
        continue;
      }
      if (polygon.length < 3) continue;

      let insideCount = 0;

      for (const person of people) {
        const [cx, cy] = person.center;
        if (pointInPolygon(cx, cy, polygon)) {
          insideCount += 1;
          const key = `${cameraId}:${zone.id}:${person.track_id}`;
          activeZoneKeys.add(key);
          if (!this.zoneEntries.has(key)) {
            this.zoneEntries.set(key, now);
          }
          const dwellSec = (now - this.zoneEntries.get(key)!) / 1000;
          person.zone_flags = [...(person.zone_flags || []), zone.name];

          if (zone.zone_type === 'RESTRICTED') {
            events.push({
              event_type: 'DANGER_ZONE_INTRUSION',
              severity: 'HIGH',
              camera_id: cameraId,
              camera_name: cameraName,
              track_id: person.track_id,
              confidence: person.confidence,
              description: `Track #${String(person.track_id).padStart(2, '0')} entered Restricted ${zone.name}`,
              reason: `Track #${String(person.track_id).padStart(2, '0')} center point (${cx.toFixed(2)}, ${cy.toFixed(2)}) remained inside Restricted ${zone.name} for ${dwellSec.toFixed(1)} seconds.`,
            });
          }

          if (dwellSec >= zone.dwell_time_sec && (zone.zone_type === 'RESTRICTED' || zone.zone_type === 'MONITORING')) {
            events.push({
              event_type: 'LOITERING_DETECTED',
              severity: zone.zone_type === 'RESTRICTED' ? 'HIGH' : 'MEDIUM',
              camera_id: cameraId,
              camera_name: cameraName,
              track_id: person.track_id,
              confidence: person.confidence,
              description: `Loitering detected in ${zone.name} (Track #${String(person.track_id).padStart(2, '0')})`,
              reason: `Track #${String(person.track_id).padStart(2, '0')} stayed inside ${zone.name} for ${dwellSec.toFixed(1)}s (configured dwell limit: ${zone.dwell_time_sec}s).`,
            });
          }
        }
      }

      if (insideCount >= zone.crowd_threshold && (zone.zone_type === 'MONITORING' || zone.zone_type === 'RESTRICTED')) {
        events.push({
          event_type: 'CROWDING',
          severity: insideCount > crowdElevatedMax ? 'HIGH' : 'MEDIUM',
          camera_id: cameraId,
          camera_name: cameraName,
          track_id: null,
          confidence: 0.9,
          description: `Crowding threshold exceeded in ${zone.name} (${insideCount} people)`,
          reason: `${insideCount} tracked individuals present inside ${zone.name} (zone threshold: ${zone.crowd_threshold}).`,
        });
      }
    }

    for (const key of Array.from(this.zoneEntries.keys())) {
      if (key.startsWith(`${cameraId}:`) && !activeZoneKeys.has(key)) {
        this.zoneEntries.delete(key);
      }
    }

    if (peopleCount > crowdElevatedMax) {
      events.push({
        event_type: 'CROWDING',
        severity: 'HIGH',
        camera_id: cameraId,
        camera_name: cameraName,
        track_id: null,
        confidence: 0.92,
        description: `High crowd density detected (${peopleCount} people in scene)`,
        reason: `Active tracked individuals (${peopleCount}) exceeded global HIGH crowding threshold (${crowdElevatedMax}).`,
      });
    }

    for (const person of people) {
      if (person.velocity_px_per_sec > 420 && person.displacement_px > 35) {
        events.push({
          event_type: 'ABNORMAL_MOVEMENT',
          severity: 'MEDIUM',
          camera_id: cameraId,
          camera_name: cameraName,
          track_id: person.track_id,
          confidence: person.confidence,
          description: `Rapid movement detected for Track #${String(person.track_id).padStart(2, '0')}`,
          reason: `Track #${String(person.track_id).padStart(2, '0')} exhibited ${person.velocity_px_per_sec.toFixed(1)} px/s displacement across consecutive frames.`,
        });
      }

      const stKey = `${cameraId}:${person.track_id}`;
      if (person.displacement_px < 3.5) {
        if (!this.stationaryStart.has(stKey)) {
          this.stationaryStart.set(stKey, now);
        } else if ((now - this.stationaryStart.get(stKey)!) / 1000 >= 20) {
          events.push({
            event_type: 'LOITERING_DETECTED',
            severity: 'LOW',
            camera_id: cameraId,
            camera_name: cameraName,
            track_id: person.track_id,
            confidence: person.confidence,
            description: `Prolonged stationary presence (Track #${String(person.track_id).padStart(2, '0')})`,
            reason: `Track #${String(person.track_id).padStart(2, '0')} moved less than 3.5 px for over 20 seconds.`,
          });
        }
      } else {
        this.stationaryStart.delete(stKey);
      }
    }

    return { events, crowdLevel };
  }
}
