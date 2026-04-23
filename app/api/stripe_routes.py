"""Stripe Checkout, Portal, and Webhook endpoints."""

import stripe
from fastapi import APIRouter, Depends, Header, HTTPException, Request, status
from pydantic import BaseModel

from app.core.auth import CurrentUser, get_current_user
from app.core.config import Settings, get_settings
from app.core.supabase import service_client

router = APIRouter(prefix="/stripe", tags=["stripe"])

FRONTEND_URL = "https://asterik.app"  # fallback; override with FRONTEND_URL env var if needed


def _stripe(settings: Settings) -> None:
    stripe.api_key = settings.stripe_secret_key


def _get_profile(user_id: str) -> dict:
    """Fetch profile row safely; returns empty dict if not found."""
    try:
        result = (
            service_client()
            .table("profiles")
            .select("stripe_customer_id, plan")
            .eq("id", user_id)
            .limit(1)
            .execute()
        )
        return result.data[0] if result.data else {}
    except Exception:
        return {}


def _frontend_url(settings: Settings) -> str:
    return getattr(settings, "frontend_url", None) or FRONTEND_URL


# ---------------------------------------------------------------------------
# Schemas
# ---------------------------------------------------------------------------
class CheckoutResponse(BaseModel):
    url: str


class PortalResponse(BaseModel):
    url: str


# ---------------------------------------------------------------------------
# POST /api/stripe/checkout
# ---------------------------------------------------------------------------
@router.post("/checkout", response_model=CheckoutResponse)
async def create_checkout_session(
    user: CurrentUser = Depends(get_current_user),
    settings: Settings = Depends(get_settings),
) -> CheckoutResponse:
    _stripe(settings)

    profile = _get_profile(user.id)

    if profile.get("plan") == "pro":
        raise HTTPException(status_code=400, detail="Already on Pro plan")

    customer_id: str | None = profile.get("stripe_customer_id")
    furl = _frontend_url(settings)

    params: dict = {
        "mode": "subscription",
        "line_items": [{"price": settings.stripe_price_id, "quantity": 1}],
        "success_url": f"{furl}/upgrade?success=1",
        "cancel_url": f"{furl}/profile",
        "client_reference_id": user.id,
    }
    if customer_id:
        params["customer"] = customer_id
    elif user.email:
        params["customer_email"] = user.email

    try:
        session = stripe.checkout.Session.create(**params)
    except stripe.StripeError as exc:
        raise HTTPException(status_code=502, detail=f"Stripe error: {exc.user_message or exc}")

    return CheckoutResponse(url=session.url)


# ---------------------------------------------------------------------------
# POST /api/stripe/portal
# ---------------------------------------------------------------------------
@router.post("/portal", response_model=PortalResponse)
async def create_portal_session(
    user: CurrentUser = Depends(get_current_user),
    settings: Settings = Depends(get_settings),
) -> PortalResponse:
    _stripe(settings)

    profile = _get_profile(user.id)
    customer_id: str | None = profile.get("stripe_customer_id")

    if not customer_id:
        raise HTTPException(status_code=400, detail="No active subscription found")

    furl = _frontend_url(settings)
    try:
        session = stripe.billing_portal.Session.create(
            customer=customer_id,
            return_url=f"{furl}/profile",
        )
    except stripe.StripeError as exc:
        raise HTTPException(status_code=502, detail=f"Stripe error: {exc.user_message or exc}")

    return PortalResponse(url=session.url)


# ---------------------------------------------------------------------------
# POST /api/stripe/webhook  (called by Stripe, no JWT auth)
# ---------------------------------------------------------------------------
@router.post("/webhook", status_code=200)
async def stripe_webhook(
    request: Request,
    stripe_signature: str | None = Header(default=None, alias="stripe-signature"),
    settings: Settings = Depends(get_settings),
) -> dict:
    _stripe(settings)

    payload = await request.body()

    try:
        event = stripe.Webhook.construct_event(
            payload, stripe_signature, settings.stripe_webhook_secret
        )
    except stripe.errors.SignatureVerificationError:
        raise HTTPException(status_code=400, detail="Invalid webhook signature")
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc))

    sb = service_client()

    if event["type"] == "checkout.session.completed":
        session = event["data"]["object"]
        user_id: str | None = session.get("client_reference_id")
        customer_id: str | None = session.get("customer")
        if user_id and customer_id:
            sb.table("profiles").update({
                "plan": "pro",
                "stripe_customer_id": customer_id,
            }).eq("id", user_id).execute()

    elif event["type"] in ("customer.subscription.deleted", "customer.subscription.paused"):
        subscription = event["data"]["object"]
        customer_id = subscription.get("customer")
        if customer_id:
            sb.table("profiles").update({"plan": "free"}).eq(
                "stripe_customer_id", customer_id
            ).execute()

    elif event["type"] == "customer.subscription.updated":
        subscription = event["data"]["object"]
        customer_id = subscription.get("customer")
        new_status = subscription.get("status")
        if customer_id and new_status:
            plan = "pro" if new_status == "active" else "free"
            sb.table("profiles").update({"plan": plan}).eq(
                "stripe_customer_id", customer_id
            ).execute()

    return {"received": True}
