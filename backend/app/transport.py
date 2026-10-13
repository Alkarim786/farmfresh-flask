from decimal import Decimal

from flask import Blueprint
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import selectinload

from .common import (
    APIError, body, forbidden, not_found, notify, ok, order_json, quote_json, req_decimal, req_str, roles_required,
)
from .extensions import db
from .models import DeliveryMode, Order, OrderStatus as S, QuoteStatus, Role, TransportQuote, User
from .orders import transition

bp = Blueprint("transport", __name__, url_prefix="/api/v1/transport")

KG_PER_UNIT = {"kg": Decimal(1), "quintal": Decimal(100)}


def _load_kg(order: Order) -> Decimal | None:
    total = Decimal(0)
    for i in order.items:
        f = KG_PER_UNIT.get(i.unit_snapshot)
        if f is None:
            return None
        total += i.qty * f
    return total


def match_info(order: Order, t: User) -> dict:
    """Simple, explainable matching: does the load fit the vehicle, and is pickup in the service area?"""
    load = _load_kg(order)
    fits = None if (load is None or not t.vehicle_capacity_kg) else load <= t.vehicle_capacity_kg
    pickup = (order.items[0].listing.location if order.items else "") or ""
    areas = [a.strip().lower() for a in (t.service_area or "").split(",") if a.strip()]
    in_area = bool(areas) and any(a in pickup.lower() or pickup.lower() in a for a in areas)
    score = (2 if fits else 0 if fits is False else 1) + (2 if in_area else 0)
    return {"load_kg": f"{load:.2f}" if load is not None else None, "fits_vehicle": fits,
            "in_service_area": in_area, "score": score}


@bp.get("/jobs")
@roles_required(Role.TRANSPORTER)
def jobs(user):
    orders = db.session.scalars(
        db.select(Order).where(Order.status == S.ACCEPTED, Order.delivery_mode == DeliveryMode.DELIVERY)
        .options(selectinload(Order.items)).order_by(Order.created_at.desc()).limit(100)
    ).all()
    mine = {q.order_id: q for q in db.session.scalars(
        db.select(TransportQuote).where(TransportQuote.transporter_id == user.id,
                                        TransportQuote.order_id.in_([o.id for o in orders])))}
    counts = dict(db.session.execute(
        db.select(TransportQuote.order_id, db.func.count()).where(
            TransportQuote.order_id.in_([o.id for o in orders]), TransportQuote.status == QuoteStatus.OPEN)
        .group_by(TransportQuote.order_id)).all())
    out = []
    for o in orders:
        d = order_json(o, user)
        d["match"] = match_info(o, user)
        d["my_quote"] = quote_json(mine[o.id]) if o.id in mine else None
        d["quote_count"] = counts.get(o.id, 0)
        out.append(d)
    out.sort(key=lambda d: (-d["match"]["score"], d["created_at"]))
    return ok(out)


@bp.get("/deliveries")
@roles_required(Role.TRANSPORTER)
def deliveries(user):
    orders = db.session.scalars(db.select(Order).where(Order.transporter_id == user.id)
                                .order_by(Order.updated_at.desc()).limit(100)).all()
    return ok([order_json(o, user) for o in orders])


@bp.post("/jobs/<int:order_id>/quotes")
@roles_required(Role.TRANSPORTER)
def submit_quote(user, order_id):
    order = db.session.get(Order, order_id)
    if order is None or order.delivery_mode != DeliveryMode.DELIVERY:
        raise not_found("Delivery job")
    if order.status != S.ACCEPTED:
        raise APIError("This job is no longer taking quotes", 409, "closed")
    data = body()
    fee = req_decimal(data, "fee", max_value=Decimal("500000"))
    try:
        eta = int(data.get("eta_hours"))
        assert 1 <= eta <= 240
    except (TypeError, ValueError, AssertionError):
        raise APIError("eta_hours must be 1-240", fields={"eta_hours": "invalid"})
    vehicle = req_str(data, "vehicle_type", max_len=60, required=False) or user.vehicle_type or "Vehicle"
    note = req_str(data, "note", max_len=300, required=False)

    q = db.session.scalar(db.select(TransportQuote).where(
        TransportQuote.order_id == order_id, TransportQuote.transporter_id == user.id))
    if q and q.status not in (QuoteStatus.OPEN, QuoteStatus.WITHDRAWN):
        raise APIError("Your quote has already been decided", 409, "closed")
    created = q is None
    if created:
        q = TransportQuote(order_id=order_id, transporter_id=user.id)
        db.session.add(q)
    q.fee, q.eta_hours, q.vehicle_type, q.note, q.status = fee, eta, vehicle, note, QuoteStatus.OPEN
    notify(order.buyer_id, f"{'New' if created else 'Updated'} delivery quote for order #{order.id}",
           f"₹{fee:,.2f} by {user.name}, about {eta} h", f"/orders/{order.id}")
    try:
        db.session.commit()
    except IntegrityError:
        db.session.rollback()
        raise APIError("You've already quoted on this job", 409, "conflict")
    return ok(quote_json(q), 201 if created else 200)


@bp.delete("/quotes/<int:quote_id>")
@roles_required(Role.TRANSPORTER)
def withdraw_quote(user, quote_id):
    q = db.session.get(TransportQuote, quote_id)
    if q is None or q.transporter_id != user.id:
        raise not_found("Quote")
    if q.status != QuoteStatus.OPEN:
        raise APIError("Only open quotes can be withdrawn", 409)
    q.status = QuoteStatus.WITHDRAWN
    db.session.commit()
    return ok(quote_json(q))


@bp.post("/quotes/<int:quote_id>/accept")
@roles_required(Role.BUYER)
def accept_quote(user, quote_id):
    q = db.session.get(TransportQuote, quote_id)
    if q is None:
        raise not_found("Quote")
    # Lock the order first; transition() re-reads it under the same lock.
    order = db.session.scalar(db.select(Order).where(Order.id == q.order_id).with_for_update())
    if order.buyer_id != user.id:
        raise forbidden("Only the buyer can choose a transporter")
    if q.status != QuoteStatus.OPEN:
        raise APIError("This quote is no longer available", 409, "closed")
    if not q.transporter.active:
        raise APIError("This transporter is unavailable", 409, "closed")
    order.transporter_id = q.transporter_id
    order.transport_fee = q.fee
    q.status = QuoteStatus.ACCEPTED
    for other in db.session.scalars(db.select(TransportQuote).where(
            TransportQuote.order_id == order.id, TransportQuote.id != q.id, TransportQuote.status == QuoteStatus.OPEN)):
        other.status = QuoteStatus.DECLINED
    order = transition(order.id, S.TRANSPORT_ASSIGNED, user, via_quote=True,
                       note=f"{q.transporter.name} booked for ₹{q.fee:,.2f}, about {q.eta_hours} h")
    return ok(order_json(order, user, detail=True))
