"""Quota enforcement helpers.

Free plan limits (per calendar month):
  - Custom prompts: blocked entirely (must use public catalog filters)
  - Gemini engine:  3 generations / month
  - Hybrid engine: 10 generations / month

Pro plan limits (per calendar month):
  - 100 total generations
  - Unlimited own filters / custom prompts
"""

from datetime import datetime, timezone

from fastapi import HTTPException, status

from app.core.supabase import service_client

# ── Limits ────────────────────────────────────────────────────────────────────
FREE_GEMINI_LIMIT  = 3
FREE_HYBRID_LIMIT  = 10
PRO_TOTAL_LIMIT    = 100


def _month_start_iso() -> str:
    now = datetime.now(timezone.utc)
    return now.replace(day=1, hour=0, minute=0, second=0, microsecond=0).isoformat()


def _count_this_month(user_id: str, engine: str | None = None) -> int:
    sb = service_client()
    q = (
        sb.table("generations")
        .select("id", count="exact")
        .eq("user_id", user_id)
        .gte("created_at", _month_start_iso())
        .in_("status", ["pending", "done"])
    )
    if engine:
        q = q.eq("engine", engine)
    res = q.execute()
    return res.count or 0


def get_user_plan(user_id: str) -> str:
    """Return 'pro' or 'free' for the given user_id."""
    sb = service_client()
    row = (
        sb.table("profiles")
        .select("plan")
        .eq("id", user_id)
        .maybe_single()
        .execute()
        .data
    )
    return (row or {}).get("plan", "free")


def enforce_generation_quota(user_id: str, engine: str, has_custom_prompt: bool) -> None:
    """Raise HTTP 402 if the user is over their generation quota."""
    plan = get_user_plan(user_id)

    if plan == "free":
        # Free users cannot use custom prompts — only public catalog filters
        if has_custom_prompt:
            raise HTTPException(
                status_code=status.HTTP_402_PAYMENT_REQUIRED,
                detail="upgrade_required:custom_prompt",
            )

        if engine == "gemini":
            used = _count_this_month(user_id, engine="gemini")
            if used >= FREE_GEMINI_LIMIT:
                raise HTTPException(
                    status_code=status.HTTP_402_PAYMENT_REQUIRED,
                    detail=f"upgrade_required:gemini_limit:{FREE_GEMINI_LIMIT}",
                )
        else:
            used = _count_this_month(user_id, engine="hybrid")
            if used >= FREE_HYBRID_LIMIT:
                raise HTTPException(
                    status_code=status.HTTP_402_PAYMENT_REQUIRED,
                    detail=f"upgrade_required:hybrid_limit:{FREE_HYBRID_LIMIT}",
                )
    else:
        # Pro: 100 total per month
        used = _count_this_month(user_id)
        if used >= PRO_TOTAL_LIMIT:
            raise HTTPException(
                status_code=status.HTTP_402_PAYMENT_REQUIRED,
                detail=f"upgrade_required:pro_limit:{PRO_TOTAL_LIMIT}",
            )


def enforce_filter_save(user_id: str) -> None:
    """Free users cannot save their own filters."""
    plan = get_user_plan(user_id)
    if plan != "pro":
        raise HTTPException(
            status_code=status.HTTP_402_PAYMENT_REQUIRED,
            detail="upgrade_required:save_filter",
        )
