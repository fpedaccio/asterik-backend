import time
import uuid
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.concurrency import run_in_threadpool

from app.core.auth import CurrentUser, get_current_user
from app.core.config import Settings, get_settings
from app.core.quota import enforce_generation_quota
from app.core.supabase import (
    download_bytes,
    service_client,
    signed_download_url,
    upload_bytes,
)
from app.engines.gemini import apply_gemini_filter
from app.engines.hybrid import apply_cached_params, apply_hybrid_filter
from app.models.schemas import (
    GenerationCreate,
    GenerationResponse,
    LutParams,
)

router = APIRouter(prefix="/generations", tags=["generations"])


@router.post("", response_model=GenerationResponse)
async def create_generation(
    body: GenerationCreate,
    user: CurrentUser = Depends(get_current_user),
    settings: Settings = Depends(get_settings),
) -> GenerationResponse:
    # Security: prevent users from running filters on other users' uploads.
    if not body.source_path.startswith(f"{user.id}/"):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="source_path does not belong to user",
        )

    prompt, cached_params = _resolve_prompt_and_params(body, user.id)
    if not prompt:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="prompt is required when filter_id is not provided",
        )

    # Quota check: must happen after prompt is resolved so we know if it's custom
    has_custom_prompt = body.filter_id is None
    enforce_generation_quota(user.id, body.engine, has_custom_prompt)

    generation_id = str(uuid.uuid4())
    sb = service_client()

    sb.table("generations").insert({
        "id": generation_id,
        "user_id": user.id,
        "filter_id": body.filter_id,
        "source_path": body.source_path,
        "engine": body.engine,
        "prompt_used": prompt,
        "status": "pending",
    }).execute()

    started = time.perf_counter()
    try:
        source_bytes = await run_in_threadpool(
            download_bytes, settings.supabase_bucket_uploads, body.source_path
        )

        if body.engine == "gemini":
            output_bytes = await run_in_threadpool(apply_gemini_filter, source_bytes, prompt)
        elif body.engine == "hybrid":
            if cached_params is not None:
                output_bytes = await run_in_threadpool(apply_cached_params, source_bytes, cached_params)
            else:
                output_bytes, lut = await run_in_threadpool(apply_hybrid_filter, source_bytes, prompt)
                # If the generation originated from a saved filter that doesn't yet have params
                # cached, persist them now so re-applies are free.
                if body.filter_id is not None:
                    sb.table("filters").update({"params": lut.model_dump()}).eq(
                        "id", body.filter_id
                    ).eq("owner_id", user.id).execute()
        else:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Unknown engine: {body.engine}",
            )

        output_path = f"{user.id}/{generation_id}.jpg"
        await run_in_threadpool(
            upload_bytes,
            settings.supabase_bucket_generations,
            output_path,
            output_bytes,
            "image/jpeg",
        )

        elapsed_ms = int((time.perf_counter() - started) * 1000)
        sb.table("generations").update({
            "status": "done",
            "output_path": output_path,
            "elapsed_ms": elapsed_ms,
        }).eq("id", generation_id).execute()

        output_url = signed_download_url(
            settings.supabase_bucket_generations,
            output_path,
            settings.signed_url_ttl_seconds,
        )

        return GenerationResponse(
            id=generation_id,
            status="done",
            engine=body.engine,
            prompt_used=prompt,
            source_path=body.source_path,
            output_path=output_path,
            output_url=output_url,
            error=None,
            elapsed_ms=elapsed_ms,
            created_at=_now_from_row(sb, generation_id),
        )

    except HTTPException:
        raise
    except Exception as exc:  # noqa: BLE001
        sb.table("generations").update({
            "status": "error",
            "error": str(exc)[:500],
        }).eq("id", generation_id).execute()
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"Generation failed: {exc}",
        ) from exc


@router.get("/{generation_id}", response_model=GenerationResponse)
def get_generation(
    generation_id: str,
    user: CurrentUser = Depends(get_current_user),
    settings: Settings = Depends(get_settings),
) -> GenerationResponse:
    row = (
        service_client()
        .table("generations")
        .select("*")
        .eq("id", generation_id)
        .eq("user_id", user.id)
        .maybe_single()
        .execute()
        .data
    )
    if not row:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not found")

    output_url = None
    if row.get("output_path"):
        output_url = signed_download_url(
            settings.supabase_bucket_generations,
            row["output_path"],
            settings.signed_url_ttl_seconds,
        )
    return GenerationResponse(
        id=row["id"],
        status=row["status"],
        engine=row["engine"],
        prompt_used=row["prompt_used"],
        source_path=row["source_path"],
        output_path=row.get("output_path"),
        output_url=output_url,
        error=row.get("error"),
        elapsed_ms=row.get("elapsed_ms"),
        created_at=row["created_at"],
    )


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
def _resolve_prompt_and_params(
    body: GenerationCreate, user_id: str
) -> tuple[str | None, LutParams | None]:
    """When filter_id is provided, fetch the filter and use its prompt/params."""
    if body.filter_id is None:
        return (body.prompt, None)

    row = (
        service_client()
        .table("filters")
        .select("prompt, params, visibility, owner_id, engine")
        .eq("id", body.filter_id)
        .maybe_single()
        .execute()
        .data
    )
    if not row:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Filter not found")
    # Public OR owned
    if row["visibility"] != "public" and row["owner_id"] != user_id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Filter not accessible")

    params: LutParams | None = None
    if row.get("params"):
        params = LutParams.model_validate(row["params"])
    return (row["prompt"], params)


def _now_from_row(sb: Any, generation_id: str) -> str:
    row = sb.table("generations").select("created_at").eq("id", generation_id).single().execute().data
    return row["created_at"]
