from functools import lru_cache

from supabase import Client, create_client

from app.core.config import get_settings


@lru_cache
def service_client() -> Client:
    settings = get_settings()
    return create_client(settings.supabase_url, settings.supabase_service_role_key)


def signed_upload_url(bucket: str, path: str) -> dict:
    """Returns a one-time signed upload URL so the browser can PUT directly to Storage."""
    return service_client().storage.from_(bucket).create_signed_upload_url(path)


def signed_download_url(bucket: str, path: str, ttl_seconds: int) -> str:
    res = service_client().storage.from_(bucket).create_signed_url(path, ttl_seconds)
    url = res.get("signedURL") or res.get("signed_url")
    if not url:
        raise RuntimeError(f"Failed to sign download URL for {bucket}/{path}: {res}")
    return url


def download_bytes(bucket: str, path: str) -> bytes:
    return service_client().storage.from_(bucket).download(path)


def upload_bytes(bucket: str, path: str, data: bytes, content_type: str = "image/jpeg") -> None:
    service_client().storage.from_(bucket).upload(
        path,
        data,
        file_options={"content-type": content_type, "upsert": "true"},
    )
