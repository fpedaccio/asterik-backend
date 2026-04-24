from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field

Engine = Literal["gemini", "hybrid"]
Visibility = Literal["public", "private"]
GenerationStatus = Literal["pending", "done", "error"]


# ---------------------------------------------------------------------------
# Uploads
# ---------------------------------------------------------------------------
class UploadSignRequest(BaseModel):
    content_type: str = "image/jpeg"


class UploadSignResponse(BaseModel):
    upload_url: str
    source_path: str
    token: str | None = None


# ---------------------------------------------------------------------------
# LUT / grading params (Engine B)
# ---------------------------------------------------------------------------
class ColorTint(BaseModel):
    r: float = Field(ge=0.0, le=1.0)
    g: float = Field(ge=0.0, le=1.0)
    b: float = Field(ge=0.0, le=1.0)
    mix: float = Field(ge=0.0, le=1.0)


class LutParams(BaseModel):
    """Structured color-grading parameters. Applied deterministically by engines/lut.py."""

    brightness: float = Field(default=0.0, ge=-1.0, le=1.0)
    contrast: float = Field(default=0.0, ge=-1.0, le=1.0)
    saturation: float = Field(default=0.0, ge=-1.0, le=1.0)
    temperature: float = Field(default=0.0, ge=-1.0, le=1.0)  # cool↔warm
    tint: float = Field(default=0.0, ge=-1.0, le=1.0)         # green↔magenta
    highlight_tint: ColorTint = Field(default_factory=lambda: ColorTint(r=1.0, g=1.0, b=1.0, mix=0.0))
    shadow_tint: ColorTint = Field(default_factory=lambda: ColorTint(r=0.0, g=0.0, b=0.0, mix=0.0))
    grain: float = Field(default=0.0, ge=0.0, le=1.0)
    vignette: float = Field(default=0.0, ge=0.0, le=1.0)


# ---------------------------------------------------------------------------
# Generations
# ---------------------------------------------------------------------------
class GenerationCreate(BaseModel):
    source_path: str
    prompt: str | None = None
    engine: Engine
    filter_id: str | None = None  # if applying an existing filter
    # Style references. Either a single path (legacy) or a list. Both get
    # normalized server-side to a list of up to 4.
    reference_source_path: str | None = None
    reference_source_paths: list[str] | None = None
    watermark: bool | None = None  # None = plan default (free=on, pro=off)


class GenerationResponse(BaseModel):
    id: str
    status: GenerationStatus
    engine: Engine
    prompt_used: str
    source_path: str
    output_path: str | None
    output_url: str | None
    error: str | None
    elapsed_ms: int | None
    created_at: datetime


# ---------------------------------------------------------------------------
# Filters
# ---------------------------------------------------------------------------
class FilterCreate(BaseModel):
    name: str = Field(min_length=1, max_length=80)
    prompt: str = Field(min_length=1, max_length=500)
    description: str | None = Field(default=None, max_length=500)
    engine: Engine
    params: LutParams | None = None
    visibility: Visibility = "private"
    preview_generation_id: str | None = None  # reuse a generation as the preview


class FilterUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=80)
    description: str | None = Field(default=None, max_length=500)
    visibility: Visibility | None = None


class FilterResponse(BaseModel):
    id: str
    owner_id: str
    name: str
    prompt: str
    description: str | None
    engine: Engine
    params: LutParams | None
    preview_url: str | None
    visibility: Visibility
    created_at: datetime
    likes_count: int = 0
    uses_count: int = 0
    liked_by_me: bool = False
    favorited_by_me: bool = False
