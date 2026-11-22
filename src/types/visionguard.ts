export type CameraSourceType = 'MOBILE' | 'WEBCAM' | 'IP' | 'RTSP' | 'VIDEO_FILE';

export type CameraStatus = 'CONNECTING' | 'CONNECTED' | 'DISCONNECTED' | 'RECONNECTING' | 'ERROR';

export type CalibrationStatus = 'NOT_CALIBRATED' | 'CALIBRATED' | 'CALIBRATION_FAILED';

export type ZoneType = 'SAFE' | 'RESTRICTED' | 'MONITORING';

export type EventType =
  | 'UNKNOWN_PERSON'
  | 'DANGER_ZONE_INTRUSION'
  | 'LOITERING_DETECTED'
  | 'CROWDING'
  | 'OBJECT_DETECTED'
  | 'ABNORMAL_MOVEMENT'
  | 'CAMERA_OFFLINE'
  | 'SYSTEM_WARNING';

export type EventSeverity = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';

export type EventStatus = 'NEW' | 'ACKNOWLEDGED' | 'RESOLVED';

export type HealthState = 'HEALTHY' | 'WARNING' | 'CRITICAL';

export interface CameraRecord {
  id: string;
  name: string;
  source_type: CameraSourceType;
  stream_url: string | null;
  status: CameraStatus;
  resolution_width: number;
  resolution_height: number;
  capture_fps: number;
  processing_fps: number;
  inference_fps: number;
  latency_ms: number;
  frame_count: number;
  brightness: number;
  contrast: number;
  is_active: number;
  last_error: string | null;
  last_frame_at: string | null;
  ingest_token?: string | null;
  created_at: string;
  updated_at: string;
}

export interface CalibrationRecord {
  id: string;
  camera_id: string;
  status: CalibrationStatus;
  chessboard_cols: number;
  chessboard_rows: number;
  square_size_mm: number;
  image_count: number;
  valid_image_count: number;
  camera_matrix_json: string | null;
  dist_coeffs_json: string | null;
  reprojection_error: number | null;
  scale_meters_per_pixel: number | null;
  calibrated_at: string | null;
  error_message: string | null;
  created_at: string;
}

export interface IdentityRecord {
  id: string;
  name: string;
  role_label: string;
  notes: string | null;
  enabled: number;
  similarity_threshold: number;
  embedding_count?: number;
  sample_image_path?: string | null;
  created_at: string;
  updated_at: string;
}

export interface FaceEmbeddingRecord {
  id: string;
  identity_id: string;
  image_path: string;
  embedding_json: string;
  model_name: string;
  quality_score: number;
  created_at: string;
}

export interface NormalizedPoint {
  x: number;
  y: number;
}

export interface ZoneRecord {
  id: string;
  camera_id: string;
  name: string;
  zone_type: ZoneType;
  polygon_json: string;
  polygon?: NormalizedPoint[];
  dwell_time_sec: number;
  crowd_threshold: number;
  enabled: number;
  created_at: string;
  updated_at: string;
}

export interface IncidentEventRecord {
  id: string;
  event_type: EventType;
  severity: EventSeverity;
  camera_id: string | null;
  camera_name: string | null;
  track_id: number | null;
  confidence: number | null;
  description: string;
  reason: string | null;
  evidence_id: string | null;
  evidence_path: string | null;
  status: EventStatus;
  metadata_json: string | null;
  created_at: string;
  acknowledged_at: string | null;
  resolved_at: string | null;
}

export interface EvidenceRecord {
  id: string;
  event_id: string;
  camera_id: string | null;
  camera_name: string | null;
  event_type: EventType;
  severity: EventSeverity;
  track_id: number | null;
  confidence: number | null;
  file_path: string;
  width: number;
  height: number;
  created_at: string;
}

export interface DetectionBox {
  track_id: number;
  class_name: string;
  confidence: number;
  bbox: [number, number, number, number]; // normalized [x1, y1, x2, y2] 0..1
  center: [number, number];
  velocity_px_per_sec: number;
  displacement_px: number;
  trajectory: [number, number][];
  identity?: {
    label: string;
    known: boolean;
    similarity: number;
    confidence: number;
  } | null;
  zone_flags?: string[];
}

export interface LiveTelemetryPayload {
  camera_id: string;
  camera_name: string;
  source_type: CameraSourceType;
  status: CameraStatus;
  engine_label: string;
  timestamp: string;
  capture_fps: number;
  processing_fps: number;
  inference_fps: number;
  latency_ms: number;
  frame_count: number;
  resolution_width: number;
  resolution_height: number;
  brightness: number;
  contrast: number;
  detections: DetectionBox[];
  object_counts: Record<string, number>;
  people_count: number;
  active_tracks: number;
  crowd_level: 'NORMAL' | 'ELEVATED' | 'HIGH';
  frame_data_url?: string;
}

export interface SystemHealthSnapshot {
  overall_state: HealthState;
  cpu_usage_pct: number;
  ram_used_mb: number;
  ram_total_mb: number;
  ram_usage_pct: number;
  gpu_status: string;
  websocket_clients: number;
  database_status: HealthState;
  cv_service_status: HealthState;
  cv_service_url: string;
  yolo_model_status: string;
  face_model_status: string;
  uptime_sec: number;
  active_cameras: number;
}

export interface SystemResourcePoint {
  timestamp: string;
  time: string;
  cpu_usage_pct: number;
  ram_usage_pct: number;
  ram_used_mb: number;
  ram_total_mb: number;
}

export interface CVConfigSettings {
  yolo_confidence: number;
  yolo_imgsz: number;
  inference_interval_ms: number;
  crowd_normal_max: number;
  crowd_elevated_max: number;
  face_similarity_threshold: number;
  event_cooldown_sec: number;
  cv_service_url: string;
  browser_edge_cv_enabled: boolean;
}

export type AppPage =
  | 'connection'
  | 'dashboard'
  | 'live'
  | 'cameras'
  | 'detection'
  | 'identities'
  | 'zones'
  | 'incidents'
  | 'evidence'
  | 'analytics'
  | 'calibration'
  | 'health';
