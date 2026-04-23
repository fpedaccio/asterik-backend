import uuid

from fastapi import APIRouter, Depends

from app.core.auth import CurrentUser, get_current_user
from app.core.config import Settings, get_settings
from app.core.supabase import signed_upload_url
from app.models.schemas import UploadSignRequest, UploadSignResponse

router = APIRouter(prefix="/uploads", tags=["uploads"])


@router.post("/sign", response_model=UploadSignResponse)
def sign_upload(
    _body: UploadSignRequest,
    user: CurrentUser = Depends(get_current_user),
    settings: Settings = Depends(get_settings),
) -> UploadSignResponse:
    source_path = f"{user.id}/{uuid.uuid4()}"
    res = signed_upload_url(settings.supabase_bucket_uploads, source_path)
    return UploadSignResponse(
        upload_url=res.get("signed_url") or res.get("signedURL") or "",
        source_path=source_path,
        token=res.get("token"),
    )
