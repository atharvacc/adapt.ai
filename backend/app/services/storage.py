"""
MinIO-based image storage service.
Falls back to local file storage if MinIO is not available.
"""
from __future__ import annotations

import io
import logging
import os
import uuid

log = logging.getLogger(__name__)

_MINIO_ENDPOINT = os.getenv("MINIO_ENDPOINT", "localhost:9000")
_MINIO_ACCESS_KEY = os.getenv("MINIO_ACCESS_KEY", "minioadmin")
_MINIO_SECRET_KEY = os.getenv("MINIO_SECRET_KEY", "minioadmin")
_MINIO_BUCKET = os.getenv("MINIO_BUCKET", "adapt-uploads")
_MINIO_SECURE = os.getenv("MINIO_SECURE", "false").lower() == "true"

LOCAL_UPLOAD_DIR = os.path.join(os.path.dirname(__file__), "..", "..", "uploads")

_minio_client = None


def _get_minio():
    global _minio_client
    if _minio_client is not None:
        return _minio_client
    try:
        from minio import Minio
        client = Minio(
            _MINIO_ENDPOINT,
            access_key=_MINIO_ACCESS_KEY,
            secret_key=_MINIO_SECRET_KEY,
            secure=_MINIO_SECURE,
        )
        if not client.bucket_exists(_MINIO_BUCKET):
            client.make_bucket(_MINIO_BUCKET)
        _minio_client = client
        return client
    except Exception:
        log.warning("MinIO unavailable, using local file storage")
        return None


def upload_image(file_bytes: bytes, filename: str) -> str:
    ext = os.path.splitext(filename)[1] or ".png"
    key = f"{uuid.uuid4().hex}{ext}"

    client = _get_minio()
    if client:
        try:
            client.put_object(
                _MINIO_BUCKET, key,
                io.BytesIO(file_bytes), len(file_bytes),
                content_type=f"image/{ext.lstrip('.')}",
            )
            protocol = "https" if _MINIO_SECURE else "http"
            return f"{protocol}://{_MINIO_ENDPOINT}/{_MINIO_BUCKET}/{key}"
        except Exception:
            log.warning("MinIO upload failed, falling back to local")

    os.makedirs(LOCAL_UPLOAD_DIR, exist_ok=True)
    path = os.path.join(LOCAL_UPLOAD_DIR, key)
    with open(path, "wb") as f:
        f.write(file_bytes)
    host = os.getenv("BACKEND_HOST", "http://localhost:8000")
    return f"{host}/uploads/{key}"


def upload_video(file_bytes: bytes, filename: str) -> str:
    ext = os.path.splitext(filename)[1] or ".mp4"
    key = f"{uuid.uuid4().hex}{ext}"

    client = _get_minio()
    if client:
        try:
            client.put_object(
                _MINIO_BUCKET, key,
                io.BytesIO(file_bytes), len(file_bytes),
                content_type=f"video/{ext.lstrip('.')}",
            )
            protocol = "https" if _MINIO_SECURE else "http"
            url = f"{protocol}://{_MINIO_ENDPOINT}/{_MINIO_BUCKET}/{key}"
            return url
        except Exception:
            log.warning("MinIO video upload failed, falling back to local")

    os.makedirs(LOCAL_UPLOAD_DIR, exist_ok=True)
    path = os.path.join(LOCAL_UPLOAD_DIR, key)
    with open(path, "wb") as f:
        f.write(file_bytes)
    host = os.getenv("BACKEND_HOST", "http://localhost:8000")
    return f"{host}/uploads/{key}"


def get_image_url(key: str) -> str:
    client = _get_minio()
    if client:
        try:
            return client.presigned_get_object(_MINIO_BUCKET, key)
        except Exception:
            pass
    host = os.getenv("BACKEND_HOST", "http://localhost:8000")
    return f"{host}/uploads/{key}"
