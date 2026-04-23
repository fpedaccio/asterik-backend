from functools import lru_cache

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    supabase_url: str
    supabase_service_role_key: str

    supabase_bucket_uploads: str = "uploads"
    supabase_bucket_generations: str = "generations"
    supabase_bucket_filter_previews: str = "filter-previews"

    gemini_api_key: str
    gemini_image_model: str = "gemini-2.5-flash-image"
    gemini_text_model: str = "gemini-2.5-flash"

    cors_allow_origins: str = "http://localhost:3000"
    signed_url_ttl_seconds: int = Field(default=3600, ge=60)

    @property
    def cors_origins_list(self) -> list[str]:
        return [o.strip() for o in self.cors_allow_origins.split(",") if o.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()  # type: ignore[call-arg]
