import json
from typing import Any, Dict, List, Optional, Tuple
import cv2
import numpy as np
from config import FACE_SIMILARITY_THRESHOLD
from database import list_face_embeddings


def cosine_similarity(a: np.ndarray, b: np.ndarray) -> float:
    denom = (np.linalg.norm(a) * np.linalg.norm(b)) + 1e-8
    return float(np.dot(a, b) / denom)


class FaceRecognitionSubsystem:
    """Module 2: Modular Face Detection -> Alignment -> ArcFace Embedding -> Cosine Similarity."""

    def __init__(self) -> None:
        self.app = None
        self.loaded = False
        self.model_name = "ArcFace-InsightFace-buffalo_l"
        self.load_error: Optional[str] = None
        self.similarity_threshold = FACE_SIMILARITY_THRESHOLD
        self._init_model()

    def _init_model(self) -> None:
        try:
            from insightface.app import FaceAnalysis

            self.app = FaceAnalysis(name="buffalo_l", providers=["CUDAExecutionProvider", "CPUExecutionProvider"])
            self.app.prepare(ctx_id=0, det_size=(640, 640))
            self.loaded = True
            self.load_error = None
        except Exception as exc:
            self.app = None
            self.loaded = False
            self.load_error = f"InsightFace ArcFace unavailable ({exc}). Install insightface + onnxruntime."

    def extract_embedding_from_bytes(self, image_bytes: bytes) -> Dict[str, Any]:
        if not self.loaded or self.app is None:
            return {"ok": False, "error": self.load_error or "Face model not loaded."}
        arr = np.frombuffer(image_bytes, np.uint8)
        img = cv2.imdecode(arr, cv2.IMREAD_COLOR)
        if img is None:
            return {"ok": False, "error": "Invalid image file."}
        faces = self.app.get(img)
        if not faces:
            return {"ok": False, "error": "No face detected in reference image."}
        # Select highest detection score face
        best = max(faces, key=lambda f: float(f.det_score))
        emb = best.normed_embedding.tolist()
        return {
            "ok": True,
            "embedding": [round(float(v), 6) for v in emb],
            "model_name": self.model_name,
            "quality_score": round(float(best.det_score), 3),
        }

    def match_person_crop(
        self,
        frame: np.ndarray,
        bbox_norm: List[float],
        enrolled_records: Optional[List[Dict[str, Any]]] = None,
        threshold: Optional[float] = None,
    ) -> Optional[Dict[str, Any]]:
        if not self.loaded or self.app is None:
            return None

        h, w = frame.shape[:2]
        x1 = max(0, int(bbox_norm[0] * w))
        y1 = max(0, int(bbox_norm[1] * h))
        x2 = min(w, int(bbox_norm[2] * w))
        y2 = min(h, int(bbox_norm[3] * h))
        if x2 - x1 < 30 or y2 - y1 < 30:
            return None

        crop = frame[y1:y2, x1:x2]
        faces = self.app.get(crop)
        if not faces:
            return None

        best_face = max(faces, key=lambda f: float(f.det_score))
        probe = np.array(best_face.normed_embedding, dtype=np.float32)
        det_conf = round(float(best_face.det_score), 3)

        records = enrolled_records if enrolled_records is not None else list_face_embeddings()
        use_thresh = threshold if threshold is not None else self.similarity_threshold

        best_sim = -1.0
        best_name = "UNKNOWN PERSON"
        for rec in records:
            vec_raw = json.loads(rec["embedding_json"])
            if not vec_raw:
                continue
            gallery_vec = np.array(vec_raw, dtype=np.float32)
            if gallery_vec.shape != probe.shape:
                continue
            sim = cosine_similarity(probe, gallery_vec)
            if sim > best_sim:
                best_sim = sim
                best_name = rec["identity_name"]

        if best_sim >= use_thresh:
            return {
                "label": f"KNOWN PERSON: {best_name}",
                "known": True,
                "similarity": round(best_sim, 3),
                "confidence": det_conf,
            }
        return {
            "label": "UNKNOWN PERSON",
            "known": False,
            "similarity": round(max(0.0, best_sim), 3),
            "confidence": det_conf,
        }

    def evaluate_labeled_pairs(self, labeled_samples: List[Tuple[np.ndarray, str]], threshold: Optional[float] = None) -> Dict[str, Any]:
        """Compute Accuracy, Precision, Recall, FAR, FRR strictly on labeled ground-truth data."""
        if not labeled_samples:
            return {"error": "No labeled evaluation samples provided."}
        use_thresh = threshold if threshold is not None else self.similarity_threshold
        records = list_face_embeddings()
        if not records:
            return {"error": "No enrolled embeddings available for evaluation."}

        tp = fp = tn = fn = 0
        for probe_vec, expected_name in labeled_samples:
            best_sim = -1.0
            pred_name = "UNKNOWN"
            for rec in records:
                gal = np.array(json.loads(rec["embedding_json"]), dtype=np.float32)
                if gal.shape != probe_vec.shape:
                    continue
                sim = cosine_similarity(probe_vec, gal)
                if sim > best_sim:
                    best_sim = sim
                    pred_name = rec["identity_name"]

            accepted = best_sim >= use_thresh
            is_enrolled = expected_name != "UNKNOWN"
            if is_enrolled and accepted and pred_name == expected_name:
                tp += 1
            elif is_enrolled and (not accepted or pred_name != expected_name):
                fn += 1
            elif not is_enrolled and accepted:
                fp += 1
            else:
                tn += 1

        total = max(1, tp + fp + tn + fn)
        accuracy = (tp + tn) / total
        precision = tp / max(1, tp + fp)
        recall = tp / max(1, tp + fn)
        far = fp / max(1, fp + tn)
        frr = fn / max(1, tp + fn)
        return {
            "samples": total,
            "accuracy": round(accuracy, 4),
            "precision": round(precision, 4),
            "recall": round(recall, 4),
            "far": round(far, 4),
            "frr": round(frr, 4),
        }
