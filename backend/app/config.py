from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    app_name: str = "SimuQuant"
    database_url: str = "sqlite+aiosqlite:///./simquant.db"
    secret_key: str = "simquant-dev-secret-key-change-in-production"
    algorithm: str = "HS256"
    access_token_expire_minutes: int = 60 * 24

    # Bot defaults
    default_mm_bots: int = 3
    default_noise_bots: int = 2
    bot_tick_interval: float = 0.5  # seconds between bot actions

    class Config:
        env_file = ".env"


settings = Settings()
