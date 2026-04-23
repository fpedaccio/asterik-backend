from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query, status

from app.core.auth import CurrentUser, get_current_user
from app.core.config import Settings, get_settings
from app.core.quota import enforce_filter_save
from app.core.supabase import (
    download_bytes,
    service_client,
    signed_download_url,
    upload_bytes,
)
from app.models.schemas import (
    FilterCreate,
    FilterResponse,
    FilterUpdate,
    LutParams,
)

router = APIRouter(prefix="/filters", tags=["filters"])


@router.post("", response_model=FilterResponse, status_code=status.HTTP_201_CREATED)
def create_filter(
    body: FilterCreate,
    user: CurrentUser = Depends(get_current_user),
    settings: Settings = Depends(get_settings),
) -> FilterResponse:
    enforce_filter_save(user.id)

    sb = service_client()

    preview_path: str | None = None
    if body.preview_generation_id:
        # Copy the generation output into the public filter-previews bucket.
        gen = (
            sb.table("generations")
            .select("output_path, user_id")
            .eq("id", body.preview_generation_id)
            .maybe_single()
            .execute()
            .data
        )
        if not gen or gen["user_id"] != user.id or not gen.get("output_path"):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="preview_generation_id invalid",
            )
        img_bytes = download_bytes(settings.supabase_bucket_generations, gen["output_path"])
        preview_path = f"{user.id}/{body.preview_generation_id}.jpg"
        upload_bytes(
            settings.supabase_bucket_filter_previews, preview_path, img_bytes, "image/jpeg"
        )

    insert = {
        "owner_id": user.id,
        "name": body.name,
        "prompt": body.prompt,
        "description": body.description,
        "engine": body.engine,
        "params": body.params.model_dump() if body.params else None,
        "preview_path": preview_path,
        "visibility": body.visibility,
    }
    row = sb.table("filters").insert(insert).execute().data[0]
    return _to_response(row, settings)


@router.get("", response_model=list[FilterResponse])
def list_filters(
    scope: Literal["public", "mine"] = Query(default="public"),
    user: CurrentUser = Depends(get_current_user),
    settings: Settings = Depends(get_settings),
) -> list[FilterResponse]:
    sb = service_client()
    query = sb.table("filters").select("*").order("created_at", desc=True).limit(100)
    if scope == "mine":
        query = query.eq("owner_id", user.id)
    else:
        query = query.eq("visibility", "public")
    rows = query.execute().data or []
    return [_to_response(r, settings) for r in rows]


@router.get("/{filter_id}", response_model=FilterResponse)
def get_filter(
    filter_id: str,
    user: CurrentUser = Depends(get_current_user),
    settings: Settings = Depends(get_settings),
) -> FilterResponse:
    row = (
        service_client()
        .table("filters")
        .select("*")
        .eq("id", filter_id)
        .maybe_single()
        .execute()
        .data
    )
    if not row:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not found")
    if row["visibility"] != "public" and row["owner_id"] != user.id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not found")
    return _to_response(row, settings)


@router.patch("/{filter_id}", response_model=FilterResponse)
def update_filter(
    filter_id: str,
    body: FilterUpdate,
    user: CurrentUser = Depends(get_current_user),
    settings: Settings = Depends(get_settings),
) -> FilterResponse:
    updates = {k: v for k, v in body.model_dump(exclude_unset=True).items() if v is not None}
    if not updates:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="No fields to update")
    res = (
        service_client()
        .table("filters")
        .update(updates)
        .eq("id", filter_id)
        .eq("owner_id", user.id)
        .execute()
    )
    if not res.data:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not found")
    return _to_response(res.data[0], settings)


@router.delete("/{filter_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_filter(
    filter_id: str,
    user: CurrentUser = Depends(get_current_user),
) -> None:
    service_client().table("filters").delete().eq("id", filter_id).eq(
        "owner_id", user.id
    ).execute()


# ---------------------------------------------------------------------------
def _to_response(row: dict, settings: Settings) -> FilterResponse:
    preview_url: str | None = None
    if row.get("preview_path"):
        # filter-previews is public; build the public URL directly.
        preview_url = (
            f"{settings.supabase_url}/storage/v1/object/public/"
            f"{settings.supabase_bucket_filter_previews}/{row['preview_path']}"
        )
    params: LutParams | None = None
    if row.get("params"):
        try:
            params = LutParams.model_validate(row["params"])
        except Exception:
            params = None
    return FilterResponse(
        id=row["id"],
        owner_id=row["owner_id"],
        name=row["name"],
        prompt=row["prompt"],
        description=row.get("description"),
        engine=row["engine"],
        params=params,
        preview_url=preview_url,
        visibility=row["visibility"],
        created_at=row["created_at"],
    )
