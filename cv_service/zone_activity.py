import time
from typing import Any, Dict, List, Tuple


def point_in_polygon(x: float, y: float, polygon: List[Dict[str, float]]) -> bool:
    """Ray-casting point-in-polygon on normalized coordinates (0..1)."""
    inside = False
    n = len(polygon)
    if n < 3:
        return False
    j = n - 1
    for i in range(n):
        xi, yi = polygon[i]["x"], polygon[i]["y"]
        xj, yj = polygon[j]["x"], polygon[j]["y"]
        intersect = ((yi > y) != (yj > y)) and (x < (xj - xi) * (y - yi) / ((yj - yi) or 1e-9) + xi)
        if intersect:
            inside = not inside
        j = i
    return inside


class ZoneActivityEngine:
    """Module 5: Danger-Zone Intrusion, Loitering, Crowding, and Rule-Based Activity Analysis."""

    def __init__(self, crowd_normal_max: int = 4, crowd_elevated_max: int = 9) -> None:
        self.crowd_normal_max = crowd_normal_max
        self.crowd_elevated_max = crowd_elevated_max
        # (camera_id, zone_id, track_id) -> entry timestamp
        self.zone_entry_times: Dict[Tuple[str, str, int], float] = {}
        # (camera_id, track_id) -> stationary start timestamp
        self.stationary_times: Dict[Tuple[str, int], float] = {}

    def analyze(
        self,
        camera_id: str,
        camera_name: str,
        detections: List[Dict[str, Any]],
        zones: List[Dict[str, Any]],
    ) -> Tuple[List[Dict[str, Any]], str]:
        now = time.time()
        candidates: List[Dict[str, Any]] = []
        people = [d for d in detections if d["class_name"] == "person"]

        # Crowd level classification
        people_count = len(people)
        if people_count <= self.crowd_normal_max:
            crowd_level = "NORMAL"
        elif people_count <= self.crowd_elevated_max:
            crowd_level = "ELEVATED"
        else:
            crowd_level = "HIGH"

        active_zone_keys = set()

        for zone in zones:
            if not zone.get("enabled", 1):
                continue
            polygon = zone.get("polygon", [])
            zone_id = zone["id"]
            zone_name = zone["name"]
            zone_type = zone["zone_type"]
            dwell_limit = float(zone.get("dwell_time_sec", 5.0))
            crowd_thresh = int(zone.get("crowd_threshold", 5))
            inside_count = 0

            for person in people:
                cx, cy = person["center"]
                track_id = person["track_id"]
                if point_in_polygon(cx, cy, polygon):
                    inside_count += 1
                    key = (camera_id, zone_id, track_id)
                    active_zone_keys.add(key)
                    if key not in self.zone_entry_times:
                        self.zone_entry_times[key] = now
                    dwell = now - self.zone_entry_times[key]

                    person.setdefault("zone_flags", []).append(zone_name)

                    if zone_type == "RESTRICTED":
                        candidates.append(
                            {
                                "event_type": "DANGER_ZONE_INTRUSION",
                                "severity": "HIGH",
                                "camera_id": camera_id,
                                "camera_name": camera_name,
                                "track_id": track_id,
                                "confidence": person["confidence"],
                                "description": f"Track #{track_id:02d} entered {zone_name} (Restricted)",
                                "reason": f"Track #{track_id:02d} center point ({cx:.2f}, {cy:.2f}) remained inside Restricted {zone_name} for {dwell:.1f} seconds.",
                            }
                        )

                    if dwell >= dwell_limit and zone_type in ("RESTRICTED", "MONITORING"):
                        candidates.append(
                            {
                                "event_type": "LOITERING_DETECTED",
                                "severity": "MEDIUM" if zone_type == "MONITORING" else "HIGH",
                                "camera_id": camera_id,
                                "camera_name": camera_name,
                                "track_id": track_id,
                                "confidence": person["confidence"],
                                "description": f"Loitering detected in {zone_name} by Track #{track_id:02d}",
                                "reason": f"Track #{track_id:02d} remained inside {zone_name} for {dwell:.1f}s (threshold {dwell_limit:.1f}s).",
                            }
                        )

            if inside_count >= crowd_thresh and zone_type in ("MONITORING", "RESTRICTED"):
                candidates.append(
                    {
                        "event_type": "CROWDING",
                        "severity": "HIGH" if inside_count > self.crowd_elevated_max else "MEDIUM",
                        "camera_id": camera_id,
                        "camera_name": camera_name,
                        "track_id": None,
                        "confidence": 0.9,
                        "description": f"Crowding threshold exceeded in {zone_name} ({inside_count} people)",
                        "reason": f"Detected {inside_count} tracked individuals inside {zone_name} (configured limit: {crowd_thresh}).",
                    }
                )

        # Clean up stale zone entries
        for key in list(self.zone_entry_times.keys()):
            if key[0] == camera_id and key not in active_zone_keys:
                del self.zone_entry_times[key]

        # Global scene crowding if high crowd threshold exceeded
        if people_count > self.crowd_elevated_max:
            candidates.append(
                {
                    "event_type": "CROWDING",
                    "severity": "HIGH",
                    "camera_id": camera_id,
                    "camera_name": camera_name,
                    "track_id": None,
                    "confidence": 0.92,
                    "description": f"High crowd density detected ({people_count} individuals)",
                    "reason": f"Scene occupancy reached {people_count} tracked people (HIGH threshold > {self.crowd_elevated_max}).",
                }
            )

        # Explainable rule-based rapid movement & prolonged stationary presence
        for person in people:
            tid = person["track_id"]
            vel = float(person.get("velocity_px_per_sec", 0.0))
            disp = float(person.get("displacement_px", 0.0))
            if vel > 420.0 and disp > 35.0:
                candidates.append(
                    {
                        "event_type": "ABNORMAL_MOVEMENT",
                        "severity": "MEDIUM",
                        "camera_id": camera_id,
                        "camera_name": camera_name,
                        "track_id": tid,
                        "confidence": person["confidence"],
                        "description": f"Rapid movement detected for Track #{tid:02d}",
                        "reason": f"Track #{tid:02d} moved at {vel:.1f} px/s across {disp:.1f} px between consecutive inference frames.",
                    }
                )
            st_key = (camera_id, tid)
            if disp < 3.5:
                if st_key not in self.stationary_times:
                    self.stationary_times[st_key] = now
                elif now - self.stationary_times[st_key] >= 20.0:
                    candidates.append(
                        {
                            "event_type": "LOITERING_DETECTED",
                            "severity": "LOW",
                            "camera_id": camera_id,
                            "camera_name": camera_name,
                            "track_id": tid,
                            "confidence": person["confidence"],
                            "description": f"Prolonged stationary presence by Track #{tid:02d}",
                            "reason": f"Track #{tid:02d} showed < 3.5 px displacement for {now - self.stationary_times[st_key]:.1f} seconds.",
                        }
                    )
            else:
                self.stationary_times.pop(st_key, None)

        return candidates, crowd_level
