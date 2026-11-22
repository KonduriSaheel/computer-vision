# VisionGuard Demonstration Videos

Place royalty-free real-world `.mp4` / `.webm` / `.mov` footage in this directory (`sample_data/videos/`) or upload videos directly through the **Demo Mode** interface in VisionGuard.

## Recommended Capstone Demo Scenarios

1. **DEMO 01 — People Walking (`demo_01_walking.mp4`)**
   - Pedestrian walkway, campus corridor, or entrance footage showing 1–4 people walking across the frame.
   - Used to verify real-time human detection (`PERSON | confidence | ID`), persistent tracking IDs, and trajectory trails.

2. **DEMO 02 — Crowded Public Area (`demo_02_crowd.mp4`)**
   - Public plaza, transit concourse, or lobby footage with 5–12+ pedestrians.
   - Used to verify crowd-density thresholds (`0–4 NORMAL`, `5–9 ELEVATED`, `10+ HIGH`) and `CROWDING` event generation with cooldown protection.

3. **DEMO 03 — Person Entering a Restricted Area (`demo_03_restricted.mp4`)**
   - Footage where an individual crosses a designated boundary or remains stationary in a zone.
   - Used with VisionGuard's interactive Polygon Zone Editor to trigger `DANGER_ZONE_INTRUSION` (`HIGH`) and `LOITERING_DETECTED`, capture evidence snapshots, and update Incident Analytics.

## Royalty-Free Footage Sources

- Pexels Videos (https://www.pexels.com/videos/) — search for "pedestrians walking cctv" or "people walking lobby"
- Pixabay Videos (https://pixabay.com/videos/) — royalty-free surveillance/street clips
- MOTChallenge / PETS2009 / TownCentre open academic pedestrian datasets (for academic capstone evaluation)

Note: VisionGuard never fabricates video or fake detections. Uploaded or placed videos are processed by the exact same computer vision pipeline as live cameras.
