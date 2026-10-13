import re

import bcrypt
from flask import Blueprint
from flask_jwt_extended import create_access_token, create_refresh_token, get_jwt_identity, jwt_required
from sqlalchemy.exc import IntegrityError

from .common import APIError, body, current_user, login_required, ok, req_str, user_private
from .extensions import db, limiter
from .models import Role, User

bp = Blueprint("auth", __name__, url_prefix="/api/v1/auth")

EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
PHONE_RE = re.compile(r"^\+?[0-9 ]{10,15}$")
SELF_SERVICE_ROLES = {Role.FARMER, Role.BUYER, Role.TRANSPORTER}


def hash_password(pw: str) -> str:
    return bcrypt.hashpw(pw.encode(), bcrypt.gensalt(rounds=12)).decode()


def check_password(pw: str, hashed: str) -> bool:
    return bcrypt.checkpw(pw.encode(), hashed.encode())


def tokens_for(user: User) -> dict:
    claims = {"role": user.role.value}
    return {
        "access_token": create_access_token(identity=str(user.id), additional_claims=claims),
        "refresh_token": create_refresh_token(identity=str(user.id)),
        "user": user_private(user),
    }


def apply_profile(user: User, data: dict):
    user.location = req_str(data, "location", required=False, max_len=120)
    if user.role == Role.FARMER:
        user.farm_name = req_str(data, "farm_name", required=False, max_len=120)
    elif user.role == Role.BUYER:
        user.business_type = req_str(data, "business_type", required=False, max_len=60)
    elif user.role == Role.TRANSPORTER:
        user.vehicle_type = req_str(data, "vehicle_type", required=False, max_len=60)
        user.service_area = req_str(data, "service_area", required=False, max_len=200)
        cap = data.get("vehicle_capacity_kg")
        if cap not in (None, ""):
            try:
                cap = int(cap)
                assert 0 < cap <= 100_000
            except (ValueError, AssertionError, TypeError):
                raise APIError("vehicle_capacity_kg must be between 1 and 100000", fields={"vehicle_capacity_kg": "invalid"})
            user.vehicle_capacity_kg = cap


@bp.post("/register")
@limiter.limit("10 per hour")
def register():
    data = body()
    name = req_str(data, "name", max_len=120, min_len=2)
    email = req_str(data, "email", max_len=255).lower()
    if not EMAIL_RE.match(email):
        raise APIError("Enter a valid email address", fields={"email": "invalid"})
    phone = req_str(data, "phone", max_len=20, required=False)
    if phone and not PHONE_RE.match(phone):
        raise APIError("Enter a valid phone number", fields={"phone": "invalid"})
    password = data.get("password") or ""
    if not isinstance(password, str) or len(password) < 8 or len(password) > 128:
        raise APIError("Password must be 8-128 characters", fields={"password": "length"})
    try:
        role = Role(str(data.get("role", "")).upper())
    except ValueError:
        raise APIError("Choose farmer, buyer or transporter", fields={"role": "invalid"})
    if role not in SELF_SERVICE_ROLES:
        raise APIError("Choose farmer, buyer or transporter", fields={"role": "invalid"})

    user = User(name=name, email=email, phone=phone, password_hash=hash_password(password), role=role)
    apply_profile(user, data)
    db.session.add(user)
    try:
        db.session.commit()
    except IntegrityError:
        db.session.rollback()
        raise APIError("An account with this email already exists", 409, "conflict", {"email": "taken"})
    return ok(tokens_for(user), 201)


@bp.post("/login")
@limiter.limit("20 per 15 minutes")
def login():
    data = body()
    email = str(data.get("email", "")).strip().lower()
    password = str(data.get("password", ""))
    user = db.session.scalar(db.select(User).where(User.email == email))
    # Same message for unknown email and wrong password (no account enumeration).
    if user is None or not check_password(password, user.password_hash):
        raise APIError("Email or password is incorrect", 401, "invalid_credentials")
    if not user.active:
        raise APIError("This account has been suspended. Contact support.", 403, "suspended")
    return ok(tokens_for(user))


@bp.post("/refresh")
@jwt_required(refresh=True)
def refresh():
    user = db.session.get(User, int(get_jwt_identity()))
    if user is None or not user.active:
        raise APIError("Account is not active", 401, "unauthorized")
    return ok({"access_token": create_access_token(identity=str(user.id), additional_claims={"role": user.role.value})})


@bp.get("/me")
@login_required
def me(user):
    return ok(user_private(user))


@bp.patch("/me")
@login_required
def update_me(user):
    data = body()
    if "name" in data:
        user.name = req_str(data, "name", max_len=120, min_len=2)
    if "phone" in data:
        phone = req_str(data, "phone", max_len=20, required=False)
        if phone and not PHONE_RE.match(phone):
            raise APIError("Enter a valid phone number", fields={"phone": "invalid"})
        user.phone = phone
    apply_profile(user, {**user_private(user), **data})
    db.session.commit()
    return ok(user_private(user))
