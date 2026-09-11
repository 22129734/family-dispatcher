from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    gigachat_credentials: str = ""
    gigachat_scope: str = "GIGACHAT_API_PERS"
    gigachat_model: str = "GigaChat"
    gigachat_verify_ssl: bool = False

    app_env: str = "local"
    timezone: str = "Europe/Moscow"

    @property
    def gigachat_enabled(self) -> bool:
        return bool(self.gigachat_credentials)


@lru_cache
def get_settings() -> Settings:
    return Settings()
