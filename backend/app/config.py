import os
from datetime import timedelta


def _db_url() -> str:
    url = os.getenv("DATABASE_URL", "postgresql+psycopg://postgres@localhost/farmfresh")
    # Render / Heroku style URLs use postgres:// — SQLAlchemy needs an explicit driver.
    if url.startswith("postgres://"):
        url = "postgresql+psycopg://" + url[len("postgres://"):]
    elif url.startswith("postgresql://"):
        url = "postgresql+psycopg://" + url[len("postgresql://"):]
    return url


class Config:
    SECRET_KEY = os.getenv("SECRET_KEY", "dev-secret-change-me")
    JWT_SECRET_KEY = os.getenv("JWT_SECRET_KEY", os.getenv("SECRET_KEY", "dev-jwt-secret-change-me-please-32b"))
    JWT_ACCESS_TOKEN_EXPIRES = timedelta(hours=2)
    JWT_REFRESH_TOKEN_EXPIRES = timedelta(days=14)
    SQLALCHEMY_DATABASE_URI = _db_url()
    SQLALCHEMY_ENGINE_OPTIONS = {"pool_pre_ping": True}
    SQLALCHEMY_TRACK_MODIFICATIONS = False
    MAX_CONTENT_LENGTH = 6 * 1024 * 1024  # 6 MB request cap (images are resized client-side)

    RAZORPAY_KEY_ID = os.getenv("RAZORPAY_KEY_ID", "")
    RAZORPAY_KEY_SECRET = os.getenv("RAZORPAY_KEY_SECRET", "")
    RAZORPAY_WEBHOOK_SECRET = os.getenv("RAZORPAY_WEBHOOK_SECRET", "")
    # "razorpay" when keys are present, otherwise "demo" (simulated checkout, clearly labelled in the UI)
    PAYMENT_MODE = os.getenv("PAYMENT_MODE") or ("razorpay" if os.getenv("RAZORPAY_KEY_ID") else "demo")

    DATA_GOV_API_KEY = os.getenv("DATA_GOV_API_KEY", "")
    CORS_ORIGINS = os.getenv("CORS_ORIGINS", "*")
    RATELIMIT_ENABLED = os.getenv("RATELIMIT_ENABLED", "1") == "1"
    RATELIMIT_STORAGE_URI = os.getenv("REDIS_URL", "memory://")


class TestConfig(Config):
    TESTING = True
    SQLALCHEMY_DATABASE_URI = os.getenv(
        "TEST_DATABASE_URL", "postgresql+psycopg://postgres@localhost/farmfresh_test"
    )
    PAYMENT_MODE = "demo"
    RATELIMIT_ENABLED = False
