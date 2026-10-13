from flask_sqlalchemy import SQLAlchemy
from flask_migrate import Migrate
from flask_jwt_extended import JWTManager
from flask_limiter import Limiter
from flask_limiter.util import get_remote_address
from datetime import datetime

from sqlalchemy import DateTime
from sqlalchemy.orm import DeclarativeBase, registry


class Base(DeclarativeBase):
    # Every datetime column is TIMESTAMPTZ so the API always emits an explicit UTC offset.
    registry = registry(type_annotation_map={datetime: DateTime(timezone=True)})


db = SQLAlchemy(model_class=Base)
migrate = Migrate()
jwt = JWTManager()
limiter = Limiter(key_func=get_remote_address, default_limits=[])
