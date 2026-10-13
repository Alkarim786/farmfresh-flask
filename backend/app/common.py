"""Shared helpers: errors, auth decorators, validation, serialization, notifications."""
from __future__ import annotations

from decimal import Decimal, InvalidOperation
from functools import wraps

from flask import jsonify, request
from flask_jwt_extended import get_jwt_identity, verify_jwt_in_request

from .extensions import db
from .models import (
    Listing, ListingStatus, Notification, Order, OrderStatus, Role, TransportQuote, User, Review,
)


class APIError(Exception):
    def __init__(self, message: str, status: int = 400, code: str = "bad_request", fields: dict | None = None):
        super().__init__(message)
        self.message, self.status, self.code, self.fields = message, status, code, fields

    def to_response(self):
        body = {"error": {"code": self.code, "message": self.message}}
        if self.fields:
            body["error"]["fields"] = self.fields
        return jsonify(body), self.status


def not_found(what: str = "Resource"):
    return APIError(f"{what} not found", 404, "not_found")


def forbidden(msg: str = "You don't have permission to do that"):
    return APIError(msg, 403, "forbidden")


# ---------------------------------------------------------------- auth

def current_user() -> User:
    uid = int(get_jwt_identity())
    user = db.session.get(User, uid)
    if user is None or not user.active:
        raise APIError("Account is not active", 401, "unauthorized")
    return user


def roles_required(*roles: Role):
    """Require a valid access token and one of the given roles. Injects `user`."""
    def decorator(fn):
        @wraps(fn)
        def wrapper(*args, **kwargs):
            verify_jwt_in_request()
            user = current_user()
            if roles and user.role not in roles:
                raise forbidden(f"This action is only for {', '.join(r.value.lower() for r in roles)} accounts")
            return fn(user, *args, **kwargs)
        return wrapper
    return decorator


login_required = roles_required()


# ---------------------------------------------------------------- validation

def body() -> dict:
    data = request.get_json(silent=True)
    if not isinstance(data, dict):
        raise APIError("Request body must be a JSON object")
    return data


def req_str(data: dict, key: str, *, max_len: int = 200, required: bool = True, min_len: int = 1) -> str | None:
    v = data.get(key)
    if v is None or (isinstance(v, str) and not v.strip()):
        if required:
            raise APIError(f"{key} is required", fields={key: "required"})
        return None
    if not isinstance(v, str):
        raise APIError(f"{key} must be text", fields={key: "invalid"})
    v = v.strip()
    if len(v) < min_len or len(v) > max_len:
        raise APIError(f"{key} must be {min_len}-{max_len} characters", fields={key: "length"})
    return v


def req_decimal(data: dict, key: str, *, required: bool = True, min_value: Decimal | None = None,
                max_value: Decimal | None = None, allow_zero: bool = False) -> Decimal | None:
    v = data.get(key)
    if v is None or v == "":
        if required:
            raise APIError(f"{key} is required", fields={key: "required"})
        return None
    try:
        d = Decimal(str(v)).quantize(Decimal("0.01"))
    except (InvalidOperation, ValueError):
        raise APIError(f"{key} must be a number", fields={key: "invalid"})
    if not d.is_finite() or d < 0 or (d == 0 and not allow_zero):
        raise APIError(f"{key} must be greater than 0", fields={key: "invalid"})
    if min_value is not None and d < min_value:
        raise APIError(f"{key} must be at least {min_value}", fields={key: "min"})
    if max_value is not None and d > max_value:
        raise APIError(f"{key} must be at most {max_value}", fields={key: "max"})
    return d


def page_args(default_size: int = 20, max_size: int = 100) -> tuple[int, int]:
    try:
        page = max(1, int(request.args.get("page", 1)))
        size = min(max_size, max(1, int(request.args.get("page_size", default_size))))
    except ValueError:
        raise APIError("page and page_size must be integers")
    return page, size


def paginated(query, page: int, size: int, serialize):
    total = db.session.scalar(db.select(db.func.count()).select_from(query.order_by(None).subquery()))
    rows = db.session.scalars(query.limit(size).offset((page - 1) * size)).all()
    return {"items": [serialize(r) for r in rows], "page": page, "page_size": size, "total": total}


# ---------------------------------------------------------------- serialization

def money(v) -> str:
    return f"{(v or Decimal('0')):.2f}"


def iso(dt):
    return dt.isoformat() if dt else None


def user_public(u: User | None):
    if u is None:
        return None
    return {"id": u.id, "name": u.name, "location": u.location, "farm_name": u.farm_name,
            "verified": u.verified, "role": u.role.value}


def user_private(u: User):
    return {**user_public(u), "email": u.email, "phone": u.phone, "business_type": u.business_type,
            "vehicle_type": u.vehicle_type, "vehicle_capacity_kg": u.vehicle_capacity_kg,
            "service_area": u.service_area, "active": u.active, "created_at": iso(u.created_at)}


def farmer_rating(farmer_id: int) -> dict:
    avg, count = db.session.execute(
        db.select(db.func.avg(Review.rating), db.func.count(Review.id)).where(Review.farmer_id == farmer_id)
    ).one()
    return {"average": round(float(avg), 2) if avg else None, "count": count}


def listing_json(l: Listing, *, with_farmer: bool = True):
    d = {
        "id": l.id, "crop": l.crop, "variety": l.variety, "grade": l.grade, "unit": l.unit,
        "qty_total": money(l.qty_total), "qty_available": money(l.qty_available),
        "min_order_qty": money(l.min_order_qty), "price": money(l.price), "location": l.location,
        "harvest_date": iso(l.harvest_date), "description": l.description, "organic": l.organic,
        "status": l.status.value, "created_at": iso(l.created_at),
        "images": [f"/api/v1/images/{img.id}" for img in l.images], "farmer_id": l.farmer_id,
    }
    if with_farmer:
        d["farmer"] = user_public(l.farmer)
    return d


def quote_json(q: TransportQuote):
    return {"id": q.id, "order_id": q.order_id, "fee": money(q.fee), "vehicle_type": q.vehicle_type,
            "eta_hours": q.eta_hours, "note": q.note, "status": q.status.value,
            "created_at": iso(q.created_at), "transporter": user_public(q.transporter)}


def order_json(o: Order, viewer: User, *, detail: bool = False):
    show_contact = viewer.role == Role.ADMIN or o.status not in (OrderStatus.PENDING, OrderStatus.REJECTED)
    d = {
        "id": o.id, "status": o.status.value, "delivery_mode": o.delivery_mode.value,
        "payment_status": o.payment_status.value, "subtotal": money(o.subtotal),
        "transport_fee": money(o.transport_fee), "total": money(o.total), "total_qty": money(o.total_qty),
        "created_at": iso(o.created_at), "updated_at": iso(o.updated_at), "note": o.note,
        "buyer": user_public(o.buyer), "farmer": user_public(o.farmer), "transporter": user_public(o.transporter),
        "items": [{"id": i.id, "listing_id": i.listing_id, "crop": i.crop_snapshot, "unit": i.unit_snapshot,
                   "qty": money(i.qty), "unit_price": money(i.agreed_unit_price), "line_total": money(i.line_total)}
                  for i in o.items],
        "pickup_location": o.items[0].listing.location if o.items else None,
        # The exact address is only shared once the farmer has accepted (data minimisation).
        "delivery_address": o.delivery_address if (show_contact or viewer.id == o.buyer_id) else None,
    }
    if detail:
        d["events"] = [{"from": e.from_status, "to": e.to_status, "at": iso(e.at), "note": e.note,
                        "actor": e.actor.name if e.actor else "System"} for e in o.events]
        if show_contact:
            for k, u in (("buyer", o.buyer), ("farmer", o.farmer), ("transporter", o.transporter)):
                if u is not None and d[k] is not None:
                    d[k]["phone"] = u.phone
        review = db.session.scalar(db.select(Review).where(Review.order_id == o.id))
        d["review"] = {"rating": review.rating, "comment": review.comment} if review else None
    return d


def notify(user_id: int, title: str, body: str | None = None, link: str | None = None):
    db.session.add(Notification(user_id=user_id, title=title, body=body, link=link))


def ok(data=None, status: int = 200):
    return jsonify(data if data is not None else {"ok": True}), status
