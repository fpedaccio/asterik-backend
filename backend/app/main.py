from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api import filters, generations, uploads
from app.core.config import get_settings

app = FastAPI(title="FilterApps API", version="0.1.0")

settings = get_settings()

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins_list,
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(uploads.router, prefix="/api")
app.include_router(generations.router, prefix="/api")
app.include_router(filters.router, prefix="/api")


@app.get("/health")
def health() -> dict:
    return {"ok": True}
