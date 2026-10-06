from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    # LLM: любой OpenAI-совместимый API. В программе Sber500 — шлюз к моделям
    # Cloud.ru Foundation Models (ключ выдают организаторы). Без ключа или модели
    # работает детерминированный разбор правилами.
    llm_base_url: str = "https://shared1.multitool.works:4000/v1"
    llm_api_key: str = ""
    llm_model: str = ""
    llm_timeout_s: float = 20.0

    # Вход по телефону: SMS.RU, авторизация звонком (callcheck)
    smsru_api_id: str = ""
    smsru_base_url: str = "https://sms.ru"

    database_url: str = "sqlite:///./family_dispatcher.db"
    cors_origins: str = "http://localhost:5173"
    admin_token: str = ""
    web_dist_dir: str = "../web/dist"
    # Соль для обезличенных идентификаторов в выгрузках аналитики
    analytics_salt: str = "local-salt"

    app_env: str = "local"
    timezone: str = "Europe/Moscow"

    @property
    def llm_enabled(self) -> bool:
        return bool(self.llm_api_key and self.llm_model)

    @property
    def is_production(self) -> bool:
        return self.app_env == "production"


@lru_cache
def get_settings() -> Settings:
    return Settings()
