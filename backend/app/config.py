from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    gigachat_credentials: str = ""
    gigachat_scope: str = "GIGACHAT_API_PERS"
    gigachat_model: str = "GigaChat"
    gigachat_verify_ssl: bool = False

    database_url: str = "sqlite:///./family_dispatcher.db"
    cors_origins: str = "http://localhost:5173"
    admin_token: str = ""
    web_dist_dir: str = "../web/dist"

    app_env: str = "local"
    timezone: str = "Europe/Moscow"

    @property
    def gigachat_enabled(self) -> bool:
        return bool(self.gigachat_credentials)


@lru_cache
def get_settings() -> Settings:
    return Settings()
