from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    app_name: str = "Adapt AI Local"
    environment: str = "local"
    postgres_url: str = "postgresql+psycopg://adapt:adapt@localhost:5432/adapt"
    redis_url: str = "redis://localhost:6379/0"
    anthropic_api_key: str = ""
    openai_api_key: str = ""
    xai_api_key: str = ""
    voyage_api_key: str = ""

    langsmith_api_key: str = ""
    langsmith_project: str = "adapt-ai"

    frontend_url: str = "http://localhost:5173"
    backend_url: str = "http://localhost:8000"

    # X / Twitter  (OAuth 2.0 PKCE)
    x_client_id: str = ""
    x_client_secret: str = ""

    # LinkedIn  (OAuth 2.0)
    linkedin_client_id: str = ""
    linkedin_client_secret: str = ""

    # Facebook  (OAuth 2.0 — used for Instagram)
    facebook_app_id: str = ""
    facebook_app_secret: str = ""

    # TikTok  (OAuth 2.0)
    tiktok_client_key: str = ""
    tiktok_client_secret: str = ""

    model_config = SettingsConfigDict(env_file=".env", extra="ignore")


settings = Settings()
