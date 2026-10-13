"""Orders: creation with atomic stock reservation, and an explicit status state machine.

Every status change goes through `transition()`, which:
  1. locks the order row (SELECT ... FOR UPDATE),
  2. checks the move is legal from the current status and that the actor may make it,
  3. applies side effects (stock release, refunds, quote clean-up, notifications),
  4. writes an OrderEvent audit row — all in one database transaction.
"""
from __future__ import annotations

from decimal import Decimal

from flask import Blueprint, request
from sqlalchemy import or_
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import selectinload

from .common import (
    APIError, body, forbidden, login_required, not_found, notify, ok, order_json, page_args, paginated,
    req_decimal, req_str, roles_required,
)
from .extensions import db
from .models import (
    DeliveryMode, Listing, ListingStatus, Order, OrderEvent, OrderItem, OrderStatus as S, PaymentStatus,
    QuoteStatus, Review, Role, TransportQuote, User,
)

bp = Blueprint("orders", __name__, url_prefix="/api/v1/orders")

TERMINAL = {S.REJECTED, S.CANCELLED, S.COMPLETED}
MAX_ITEMS = 20


# ---------------------------------------------------------------- creation

def create_order(buyer: User, items: list[dict], *, delivery_mode: DeliveryMode, address: str | None,
                 note: str | None, idempotency_key: str | None) -> Order:
    if idempotency_key:
        existing = db.session.scalar(db.select(Order).where(
            Order.buyer_id == buyer.id, Order.idempotency_key == idempotency_key))
        if existing:
            return existing

    if not items or not isinstance(items, list) or len(items) > MAX_ITEMS:
        raise APIError(f"An order needs 1-{MAX_ITEMS} items")
    wanted: dict[int, Decimal] = {}
    for it in items:
        if not isinstance(it, dict):
            raise APIError("Each item needs listing_id and qty")
        try:
            lid = int(it.get("listing_id"))
        except (TypeError, ValueError):
            raise APIError("Each item needs a valid listing_id")
        wanted[lid] = wanted.get(lid, Decimal("0")) + req_decimal(it, "qty", max_value=Decimal("1000000"))

    # Lock the listing rows in a fixed order (by id) so concurrent orders can't deadlock,
    # then check and decrement stock while holding the locks.
    listings = db.session.scalars(
        db.select(Listing).where(Listing.id.in_(wanted)).order_by(Listing.id).with_for_update()
    ).all()
    if len(listings) != len(wanted):
        db.session.rollback()
        raise APIError("One of the listings no longer exists", 404, "not_found")
    farmer_ids = {l.farmer_id for l in listings}
    if len(farmer_ids) != 1:
        db.session.rollback()
        raise APIError("An order can only contain produce from one farmer")
    farmer_id = farmer_ids.pop()
    if farmer_id == buyer.id:
        db.session.rollback()
        raise APIError("You can't order your own produce")

    order = Order(buyer_id=buyer.id, farmer_id=farmer_id, delivery_mode=delivery_mode,
                  delivery_address=address, note=note, subtotal=Decimal("0"), idempotency_key=idempotency_key)
    for l in listings:
        qty = wanted[l.id]
        if l.status != ListingStatus.ACTIVE:
            db.session.rollback()
            raise APIError(f"{l.crop} is no longer available", 409, "unavailable")
        if qty < l.min_order_qty:
            db.session.rollback()
            raise APIError(f"Minimum order for {l.crop} is {l.min_order_qty:g} {l.unit}", 422, "below_minimum")
        if qty > l.qty_available:
            db.session.rollback()
            raise APIError(f"Only {l.qty_available:g} {l.unit} of {l.crop} left", 409, "insufficient_stock")
        l.qty_available -= qty
        if l.qty_available == 0:
            l.status = ListingStatus.SOLD_OUT
        item = OrderItem(listing_id=l.id, qty=qty, agreed_unit_price=l.price,
                         crop_snapshot=f"{l.crop}{f' ({l.variety})' if l.variety else ''}", unit_snapshot=l.unit)
        order.items.append(item)
        order.subtotal += item.line_total

    db.session.add(order)
    db.session.flush()
    order.events.append(OrderEvent(from_status=None, to_status=S.PENDING.value, actor_id=buyer.id, note="Order placed"))
    notify(farmer_id, f"New order #{order.id} from {buyer.name}",
           f"₹{order.subtotal:,.2f} for {', '.join(i.crop_snapshot for i in order.items)}", f"/orders/{order.id}")
    try:
        db.session.commit()
    except IntegrityError:
        # Two requests raced with the same idempotency key: return the winner.
        db.session.rollback()
        existing = db.session.scalar(db.select(Order).where(
            Order.buyer_id == buyer.id, Order.idempotency_key == idempotency_key))
        if existing:
            return existing
        raise
    return order


def release_stock(order: Order):
    ids = sorted(i.listing_id for i in order.items)
    locked = {l.id: l for l in db.session.scalars(
        db.select(Listing).where(Listing.id.in_(ids)).order_by(Listing.id).with_for_update())}
    for item in order.items:
        l = locked[item.listing_id]
        l.qty_available += item.qty
        if l.status == ListingStatus.SOLD_OUT and l.qty_available > 0:
            l.status = ListingStatus.ACTIVE


# ---------------------------------------------------------------- state machine

def _check(order: Order, to: S, actor: User, *, via_quote: bool = False):
    frm = order.status
    is_admin = actor.role == Role.ADMIN
    is_buyer, is_farmer = actor.id == order.buyer_id, actor.id == order.farmer_id
    is_transporter = order.transporter_id is not None and actor.id == order.transporter_id
    pickup = order.delivery_mode == DeliveryMode.PICKUP
    paid = order.payment_status == PaymentStatus.PAID

    def deny(msg="You can't make this change"):
        raise APIError(msg, 409 if (is_buyer or is_farmer or is_transporter or is_admin) else 403, "invalid_transition")

    if frm in TERMINAL:
        deny(f"Order is already {frm.value.lower()}")
    if to == S.ACCEPTED or to == S.REJECTED:
        if frm != S.PENDING:
            deny("Only pending orders can be accepted or rejected")
        if not is_farmer:
            raise forbidden("Only the farmer can accept or reject this order")
    elif to == S.CANCELLED:
        if frm in (S.DISPATCHED, S.DELIVERED):
            deny("Orders can't be cancelled once dispatched")
        if not (is_buyer or is_admin or (is_farmer and frm == S.ACCEPTED)):
            raise forbidden("You can't cancel this order")
    elif to == S.TRANSPORT_ASSIGNED:
        if not via_quote or frm != S.ACCEPTED or pickup:
            deny("Transport is assigned by accepting a quote")
    elif to == S.DISPATCHED:
        if frm != S.TRANSPORT_ASSIGNED:
            deny("Order must have transport assigned before dispatch")
        if not is_transporter:
            raise forbidden("Only the assigned transporter can mark dispatch")
        if not paid:
            deny("The buyer hasn't paid yet")
    elif to == S.DELIVERED:
        if pickup:
            if frm != S.ACCEPTED or not is_farmer:
                deny("For pickup orders the farmer marks the hand-over")
            if not paid:
                deny("The buyer hasn't paid yet")
        elif frm != S.DISPATCHED or not is_transporter:
            deny("Only the assigned transporter can mark delivery after dispatch")
    elif to == S.COMPLETED:
        if frm != S.DELIVERED or not (is_buyer or is_admin):
            deny("The buyer confirms receipt after delivery")
    else:
        deny("Unknown status")


def transition(order_id: int, to: S, actor: User, *, note: str | None = None, via_quote: bool = False,
               commit: bool = True) -> Order:
    order = db.session.scalar(db.select(Order).where(Order.id == order_id).with_for_update())
    if order is None:
        raise not_found("Order")
    _check(order, to, actor, via_quote=via_quote)
    frm = order.status

    if to in (S.REJECTED, S.CANCELLED):
        release_stock(order)
        for q in db.session.scalars(db.select(TransportQuote).where(
                TransportQuote.order_id == order.id, TransportQuote.status == QuoteStatus.OPEN)):
            q.status = QuoteStatus.DECLINED
        if order.payment_status == PaymentStatus.PAID:
            from .payments import refund_order
            refund_order(order, actor)

    order.status = to
    order.events.append(OrderEvent(from_status=frm.value, to_status=to.value, actor_id=actor.id, note=note))

    label = to.value.replace("_", " ").lower()
    link = f"/orders/{order.id}"
    for uid in {order.buyer_id, order.farmer_id, order.transporter_id} - {None, actor.id}:
        notify(uid, f"Order #{order.id} is {label}", note, link)
    if to == S.ACCEPTED and order.delivery_mode == DeliveryMode.DELIVERY:
        # Tell transporters there's a new delivery job.
        for t in db.session.scalars(db.select(User).where(User.role == Role.TRANSPORTER, User.active.is_(True))):
            notify(t.id, f"New delivery job #{order.id}",
                   f"{order.total_qty:g} {order.items[0].unit_snapshot} from {order.items[0].listing.location}",
                   "/transport")
    if commit:
        db.session.commit()
    return order


# ---------------------------------------------------------------- routes

def _visible(order: Order, user: User) -> bool:
    if user.role == Role.ADMIN or user.id in (order.buyer_id, order.farmer_id, order.transporter_id):
        return True
    # Transporters may view open delivery jobs they could quote on.
    return (user.role == Role.TRANSPORTER and order.status == S.ACCEPTED
            and order.delivery_mode == DeliveryMode.DELIVERY)


def get_order_for(user: User, order_id: int) -> Order:
    order = db.session.get(Order, order_id)
    if order is None or not _visible(order, user):
        raise not_found("Order")
    return order


@bp.post("")
@roles_required(Role.BUYER)
def place_order(user):
    data = body()
    try:
        mode = DeliveryMode(str(data.get("delivery_mode", "DELIVERY")).upper())
    except ValueError:
        raise APIError("delivery_mode must be DELIVERY or PICKUP")
    address = req_str(data, "delivery_address", max_len=300, required=mode == DeliveryMode.DELIVERY)
    note = req_str(data, "note", max_len=500, required=False)
    key = request.headers.get("Idempotency-Key")
    if key and len(key) > 64:
        raise APIError("Idempotency-Key is too long")
    order = create_order(user, data.get("items"), delivery_mode=mode, address=address, note=note,
                         idempotency_key=key)
    return ok(order_json(order, user, detail=True), 201)


@bp.get("")
@login_required
def list_orders(user):
    page, size = page_args()
    q = db.select(Order).options(selectinload(Order.items), selectinload(Order.buyer),
                                 selectinload(Order.farmer), selectinload(Order.transporter))
    if user.role == Role.BUYER:
        q = q.where(Order.buyer_id == user.id)
    elif user.role == Role.FARMER:
        q = q.where(Order.farmer_id == user.id)
    elif user.role == Role.TRANSPORTER:
        q = q.where(Order.transporter_id == user.id)
    if status := request.args.get("status"):
        statuses = []
        for s in status.upper().split(","):
            try:
                statuses.append(S(s))
            except ValueError:
                raise APIError(f"Unknown status {s}")
        q = q.where(Order.status.in_(statuses))
    if request.args.get("active") == "1":
        q = q.where(Order.status.not_in(list(TERMINAL)))
    q = q.order_by(Order.created_at.desc())
    return ok(paginated(q, page, size, lambda o: order_json(o, user)))


@bp.get("/<int:order_id>")
@login_required
def get_order(user, order_id):
    order = get_order_for(user, order_id)
    data = order_json(order, user, detail=True)
    if user.id == order.buyer_id or user.role == Role.ADMIN or user.id == order.farmer_id:
        from .common import quote_json
        quotes = db.session.scalars(db.select(TransportQuote).where(TransportQuote.order_id == order.id)
                                    .order_by(TransportQuote.fee)).all()
        data["quotes"] = [quote_json(q) for q in quotes]
    elif user.role == Role.TRANSPORTER:
        from .common import quote_json
        mine = db.session.scalar(db.select(TransportQuote).where(
            TransportQuote.order_id == order.id, TransportQuote.transporter_id == user.id))
        data["my_quote"] = quote_json(mine) if mine else None
    return ok(data)


@bp.patch("/<int:order_id>/status")
@login_required
def change_status(user, order_id):
    data = body()
    try:
        to = S(str(data.get("status", "")).upper())
    except ValueError:
        raise APIError("Unknown status")
    get_order_for(user, order_id)  # visibility check before revealing anything
    note = req_str(data, "note", max_len=300, required=False)
    order = transition(order_id, to, user, note=note)
    return ok(order_json(order, user, detail=True))


@bp.post("/<int:order_id>/review")
@roles_required(Role.BUYER)
def review(user, order_id):
    order = get_order_for(user, order_id)
    if order.buyer_id != user.id:
        raise forbidden()
    if order.status != S.COMPLETED:
        raise APIError("You can review once the order is completed", 409)
    data = body()
    try:
        rating = int(data.get("rating"))
        assert 1 <= rating <= 5
    except (TypeError, ValueError, AssertionError):
        raise APIError("rating must be 1-5", fields={"rating": "invalid"})
    db.session.add(Review(order_id=order.id, reviewer_id=user.id, farmer_id=order.farmer_id, rating=rating,
                          comment=req_str(data, "comment", max_len=500, required=False)))
    notify(order.farmer_id, f"{user.name} rated order #{order.id} {rating}/5", None, f"/orders/{order.id}")
    try:
        db.session.commit()
    except IntegrityError:
        db.session.rollback()
        raise APIError("You've already reviewed this order", 409, "conflict")
    return ok({"ok": True}, 201)
