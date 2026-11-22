from typing import Any, Dict, List
import cv2
import numpy as np
from database import save_calibration


def run_chessboard_calibration(
    camera_id: str,
    image_buffers: List[bytes],
    cols: int = 9,
    rows: int = 6,
    square_size_mm: float = 25.0,
) -> Dict[str, Any]:
    """Module 1: OpenCV Chessboard Camera Calibration."""
    criteria = (cv2.TERM_CRITERIA_EPS + cv2.TERM_CRITERIA_MAX_ITER, 30, 0.001)
    objp = np.zeros((rows * cols, 3), np.float32)
    objp[:, :2] = np.mgrid[0:cols, 0:rows].T.reshape(-1, 2) * square_size_mm

    objpoints: List[np.ndarray] = []
    imgpoints: List[np.ndarray] = []
    img_size = None

    for raw in image_buffers:
        arr = np.frombuffer(raw, np.uint8)
        img = cv2.imdecode(arr, cv2.IMREAD_COLOR)
        if img is None:
            continue
        gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
        img_size = gray.shape[::-1]
        found, corners = cv2.findChessboardCorners(gray, (cols, rows), None)
        if found:
            corners2 = cv2.cornerSubPix(gray, corners, (11, 11), (-1, -1), criteria)
            objpoints.append(objp)
            imgpoints.append(corners2)

    if len(objpoints) < 3 or img_size is None:
        err_msg = f"Valid chessboard corners detected in only {len(objpoints)}/{len(image_buffers)} images (minimum 3 required)."
        save_calibration(camera_id, "CALIBRATION_FAILED", cols, rows, square_size_mm, len(objpoints), None, None, None)
        return {
            "status": "CALIBRATION_FAILED",
            "valid_image_count": len(objpoints),
            "error_message": err_msg,
        }

    ret, mtx, dist, rvecs, tvecs = cv2.calibrateCamera(objpoints, imgpoints, img_size, None, None)
    if not ret:
        save_calibration(camera_id, "CALIBRATION_FAILED", cols, rows, square_size_mm, len(objpoints), None, None, None)
        return {
            "status": "CALIBRATION_FAILED",
            "valid_image_count": len(objpoints),
            "error_message": "cv2.calibrateCamera failed to converge.",
        }

    total_err = 0.0
    for i in range(len(objpoints)):
        imgpoints2, _ = cv2.projectPoints(objpoints[i], rvecs[i], tvecs[i], mtx, dist)
        err = cv2.norm(imgpoints[i], imgpoints2, cv2.NORM_L2) / len(imgpoints2)
        total_err += err
    mean_err = round(float(total_err / len(objpoints)), 5)

    camera_matrix = [[round(float(v), 4) for v in row] for row in mtx.tolist()]
    dist_coeffs = [round(float(v), 6) for v in dist.flatten().tolist()]

    save_calibration(
        camera_id,
        "CALIBRATED",
        cols,
        rows,
        square_size_mm,
        len(objpoints),
        camera_matrix,
        dist_coeffs,
        mean_err,
    )
    return {
        "status": "CALIBRATED",
        "valid_image_count": len(objpoints),
        "camera_matrix": camera_matrix,
        "dist_coeffs": dist_coeffs,
        "reprojection_error": mean_err,
    }
