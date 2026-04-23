"""Quota status endpoint — lets the frontend know the user's plan and usage."""

from fastapi import APIRouter, Depends
from pydantic import BaseModel

from app.core.auth import CurrentUser, get_current_user
from app.core.quota import (
    FREE_GEMINI_LIMIT,
    FREE_HYBRID_LIMIT,
    PRO_TOTAL_LIMIT,
    _count_this_month,
    get_user_plan,
)

router = APIRouter(prefix="/quota", tags=["quota"])


class QuotaResponse(BaseModel):
    plan: str                  # 'free' | 'pro'
    gemini_used: int
    gemini_limit: int
    hybrid_used: int
    hybrid_limit: int
    total_used: int
    total_limit: int
    can_use_custom_prompt: bool


@router.get("", response_model=QuotaResponse)
def get_quota(user: CurrentUser = Depends(get_current_user)) -> QuotaResponse:
    plan = get_user_plan(user.id)

    gemini_used = _count_this_month(user.id, engine="gemini")
    hybrid_used = _count_this_month(user.id, engine="hybrid")
    total_used = gemini_used + hybrid_used

    if plan == "pro":
        total_used = _count_this_month(user.id)
        return QuotaResponse(
            plan="pro",
            gemini_used=total_used,
            gemini_limit=PRO_TOTAL_LIMIT,
            hybrid_used=total_used,
            hybrid_limit=PRO_TOTAL_LIMIT,
            total_used=total_used,
            total_limit=PRO_TOTAL_LIMIT,
            can_use_custom_prompt=True,
        )

    return QuotaResponse(
        plan="free",
        gemini_used=gemini_used,
        gemini_limit=FREE_GEMINI_LIMIT,
        hybrid_used=hybrid_used,
        hybrid_limit=FREE_HYBRID_LIMIT,
        total_used=total_used,
        total_limit=FREE_GEMINI_LIMIT + FREE_HYBRID_LIMIT,
        can_use_custom_prompt=False,
    )
