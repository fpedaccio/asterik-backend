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

Scope = Literal["public", "top", "new", "mine", "favorites"]


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
    return _to_response(row, settings, user_id=user.id)


@router.get("", response_model=list[FilterResponse])
def list_filters(
    scope: Scope = Query(default="top"),
    user: CurrentUser = Depends(get_current_user),
    settings: Settings = Depends(get_settings),
) -> list[FilterResponse]:
    sb = service_client()

    if scope == "top":
        # Trending: time-decayed score via RPC
        res = sb.rpc("filters_top", {"p_limit": 100}).execute()
        rows = res.data or []
    elif scope == "new":
        rows = (
            sb.table("filters")
            .select("*")
            .eq("visibility", "public")
            .order("created_at", desc=True)
            .limit(100)
            .execute()
            .data or []
        )
    elif scope == "favorites":
        # Join via filter_favorites
        fav_rows = (
            sb.table("filter_favorites")
            .select("filter_id, created_at")
            .eq("user_id", user.id)
            .order("created_at", desc=True)
            .execute()
            .data or []
        )
        filter_ids = [f["filter_id"] for f in fav_rows]
        if not filter_ids:
            return []
        rows = (
            sb.table("filters")
            .select("*")
            .in_("id", filter_ids)
            .execute()
            .data or []
        )
        # Preserve favorite order (most recently favorited first)
        by_id = {r["id"]: r for r in rows}
        rows = [by_id[fid] for fid in filter_ids if fid in by_id]
    elif scope == "mine":
        rows = (
            sb.table("filters")
            .select("*")
            .eq("owner_id", user.id)
            .order("created_at", desc=True)
            .limit(100)
            .execute()
            .data or []
        )
    else:  # 'public' — legacy, same as new
        rows = (
            sb.table("filters")
            .select("*")
            .eq("visibility", "public")
            .order("created_at", desc=True)
            .limit(100)
            .execute()
            .data or []
        )

    # Batch-fetch user's likes + favorites for these filter IDs
    ids = [r["id"] for r in rows]
    liked = _fetch_user_relation_ids(sb, "filter_likes", user.id, ids)
    faved = _fetch_user_relation_ids(sb, "filter_favorites", user.id, ids)

    return [_to_response(r, settings, user_id=user.id, liked_set=liked, faved_set=faved) for r in rows]


@router.get("/{filter_id}", response_model=FilterResponse)
def get_filter(
    filter_id: str,
    user: CurrentUser = Depends(get_current_user),
    settings: Settings = Depends(get_settings),
) -> FilterResponse:
    sb = service_client()
    row = (
        sb.table("filters")
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

    liked = _fetch_user_relation_ids(sb, "filter_likes", user.id, [filter_id])
    faved = _fetch_user_relation_ids(sb, "filter_favorites", user.id, [filter_id])
    return _to_response(row, settings, user_id=user.id, liked_set=liked, faved_set=faved)


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
    return _to_response(res.data[0], settings, user_id=user.id)


@router.delete("/{filter_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_filter(
    filter_id: str,
    user: CurrentUser = Depends(get_current_user),
) -> None:
    service_client().table("filters").delete().eq("id", filter_id).eq(
        "owner_id", user.id
    ).execute()


# ---------------------------------------------------------------------------
# Likes
# ---------------------------------------------------------------------------
@router.post("/{filter_id}/like", status_code=status.HTTP_204_NO_CONTENT)
def like_filter(
    filter_id: str,
    user: CurrentUser = Depends(get_current_user),
) -> None:
    sb = service_client()
    f = sb.table("filters").select("owner_id, visibility").eq("id", filter_id).maybe_single().execute().data
    if not f:
        raise HTTPException(status_code=404, detail="Filter not found")
    if f["owner_id"] == user.id:
        raise HTTPException(status_code=400, detail="Cannot like your own filter")
    if f["visibility"] != "public":
        raise HTTPException(status_code=403, detail="Filter is not public")

    try:
        sb.table("filter_likes").insert({
            "user_id": user.id,
            "filter_id": filter_id,
        }).execute()
    except Exception:
        # Likely unique violation — already liked, treat as idempotent
        pass


@router.delete("/{filter_id}/like", status_code=status.HTTP_204_NO_CONTENT)
def unlike_filter(
    filter_id: str,
    user: CurrentUser = Depends(get_current_user),
) -> None:
    service_client().table("filter_likes").delete().eq(
        "user_id", user.id
    ).eq("filter_id", filter_id).execute()


# ---------------------------------------------------------------------------
# Favorites
# ---------------------------------------------------------------------------
@router.post("/{filter_id}/favorite", status_code=status.HTTP_204_NO_CONTENT)
def favorite_filter(
    filter_id: str,
    user: CurrentUser = Depends(get_current_user),
) -> None:
    sb = service_client()
    f = sb.table("filters").select("id, visibility, owner_id").eq("id", filter_id).maybe_single().execute().data
    if not f:
        raise HTTPException(status_code=404, detail="Filter not found")
    if f["visibility"] != "public" and f["owner_id"] != user.id:
        raise HTTPException(status_code=403, detail="Filter is not accessible")

    try:
        sb.table("filter_favorites").insert({
            "user_id": user.id,
            "filter_id": filter_id,
        }).execute()
    except Exception:
        pass


@router.delete("/{filter_id}/favorite", status_code=status.HTTP_204_NO_CONTENT)
def unfavorite_filter(
    filter_id: str,
    user: CurrentUser = Depends(get_current_user),
) -> None:
    service_client().table("filter_favorites").delete().eq(
        "user_id", user.id
    ).eq("filter_id", filter_id).execute()


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
def _fetch_user_relation_ids(sb, table: str, user_id: str, filter_ids: list[str]) -> set[str]:
    if not filter_ids:
        return set()
    rows = (
        sb.table(table)
        .select("filter_id")
        .eq("user_id", user_id)
        .in_("filter_id", filter_ids)
        .execute()
        .data or []
    )
    return {r["filter_id"] for r in rows}


def _to_response(
    row: dict,
    settings: Settings,
    *,
    user_id: str,
    liked_set: set[str] | None = None,
    faved_set: set[str] | None = None,
) -> FilterResponse:
    preview_url: str | None = None
    if row.get("preview_path"):
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

    fid = row["id"]
    return FilterResponse(
        id=fid,
        owner_id=row["owner_id"],
        name=row["name"],
        prompt=row["prompt"],
        description=row.get("description"),
        engine=row["engine"],
        params=params,
        preview_url=preview_url,
        visibility=row["visibility"],
        created_at=row["created_at"],
        likes_count=row.get("likes_count", 0) or 0,
        uses_count=row.get("uses_count", 0) or 0,
        liked_by_me=fid in liked_set if liked_set is not None else False,
        favorited_by_me=fid in faved_set if faved_set is not None else False,
    )
