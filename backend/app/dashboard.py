"""Role-specific analytics, notifications and admin moderation."""
from datetime import timedelta
from decimal import Decimal

from flask import Blueprint, request

from .common import (
    APIError, body, farmer_rating, listing_json, login_required, money, not_found, notify, ok, order_json,
    page_args, paginated, roles_required, user_private,
)
from .extensions import db
from .models import (
    Listing, ListingStatus, Notification, Order, OrderItem, OrderStatus as S, PaymentStatus, Role, TransportQuote,
    User, utcnow,
)

bp = Blueprint("dashboard", __name__, url_prefix="/api/v1")

REVENUE_STATUSES = [S.ACCEPTED, S.TRANSPORT_ASSIGNED, S.DISPATCHED, S.DELIVERED, S.COMPLETED]


def _monthly(filter_col, user_id, amount_col, months=6):
    since = utcnow() - timedelta(days=31 * months)
    month = db.func.date_trunc("month", Order.created_at)
    rows = db.session.execute(
        db.select(month, db.func.sum(amount_col), db.func.count(Order.id))
        .where(filter_col == user_id, Order.created_at >= since, Order.status.in_(REVENUE_STATUSES))
        .group_by(month).order_by(month)
    ).all()
    return [{"month": m.strftime("%b %Y"), "amount": money(a), "orders": n} for m, a, n in rows]


def _status_counts(where):
    rows = db.session.execute(db.select(Order.status, db.func.count()).where(where).group_by(Order.status)).all()
    return {s.value: n for s, n in rows}


@bp.get("/dashboard")
@login_required
def summary(user):
    if user.role == Role.FARMER:
        top = db.session.execute(
            db.select(OrderItem.crop_snapshot, db.func.sum(OrderItem.qty), db.func.sum(OrderItem.qty * OrderItem.agreed_unit_price))
            .join(Order).where(Order.farmer_id == user.id, Order.status.in_(REVENUE_STATUSES))
            .group_by(OrderItem.crop_snapshot).order_by(db.func.sum(OrderItem.qty * OrderItem.agreed_unit_price).desc()).limit(5)
        ).all()
        earned = db.session.scalar(db.select(db.func.sum(Order.subtotal)).where(
            Order.farmer_id == user.id, Order.payment_status == PaymentStatus.PAID,
            Order.status.in_(REVENUE_STATUSES))) or Decimal(0)
        live = db.session.scalar(db.select(db.func.count(Listing.id)).where(
            Listing.farmer_id == user.id, Listing.status == ListingStatus.ACTIVE))
        return ok({
            "role": "FARMER", "earned": money(earned), "live_listings": live,
            "pending_orders": _status_counts(Order.farmer_id == user.id).get("PENDING", 0),
            "status_counts": _status_counts(Order.farmer_id == user.id),
            "monthly": _monthly(Order.farmer_id, user.id, Order.subtotal),
            "top_crops": [{"crop": c, "qty": money(q), "revenue": money(r)} for c, q, r in top],
            "rating": farmer_rating(user.id),
        })
    if user.role == Role.BUYER:
        spent = db.session.scalar(db.select(db.func.sum(Order.subtotal + Order.transport_fee)).where(
            Order.buyer_id == user.id, Order.payment_status == PaymentStatus.PAID)) or Decimal(0)
        return ok({"role": "BUYER", "spent": money(spent),
                   "status_counts": _status_counts(Order.buyer_id == user.id),
                   "monthly": _monthly(Order.buyer_id, user.id, Order.subtotal + Order.transport_fee)})
    if user.role == Role.TRANSPORTER:
        earned = db.session.scalar(db.select(db.func.sum(Order.transport_fee)).where(
            Order.transporter_id == user.id, Order.status.in_([S.DELIVERED, S.COMPLETED]))) or Decimal(0)
        open_quotes = db.session.scalar(db.select(db.func.count()).select_from(TransportQuote).where(
            TransportQuote.transporter_id == user.id, TransportQuote.status == "OPEN"))
        open_jobs = db.session.scalar(db.select(db.func.count(Order.id)).where(
            Order.status == S.ACCEPTED, Order.delivery_mode == "DELIVERY"))
        return ok({"role": "TRANSPORTER", "earned": money(earned), "open_quotes": open_quotes, "open_jobs": open_jobs,
                   "status_counts": _status_counts(Order.transporter_id == user.id),
                   "monthly": _monthly(Order.transporter_id, user.id, Order.transport_fee)})
    # admin
    gmv = db.session.scalar(db.select(db.func.sum(Order.subtotal + Order.transport_fee)).where(
        Order.payment_status == PaymentStatus.PAID)) or Decimal(0)
    users = dict(db.session.execute(db.select(User.role, db.func.count()).group_by(User.role)).all())
    since = utcnow() - timedelta(days=180)
    month = db.func.date_trunc("month", Order.created_at)
    monthly = db.session.execute(
        db.select(month, db.func.sum(Order.subtotal + Order.transport_fee), db.func.count())
        .where(Order.created_at >= since, Order.status.in_(REVENUE_STATUSES)).group_by(month).order_by(month)).all()
    top = db.session.execute(
        db.select(Listing.crop, db.func.sum(OrderItem.qty * OrderItem.agreed_unit_price))
        .join(OrderItem, OrderItem.listing_id == Listing.id).join(Order)
        .where(Order.status.in_(REVENUE_STATUSES)).group_by(Listing.crop)
        .order_by(db.func.sum(OrderItem.qty * OrderItem.agreed_unit_price).desc()).limit(6)).all()
    return ok({"role": "ADMIN", "gmv": money(gmv), "users": {r.value: n for r, n in users.items()},
               "unverified": db.session.scalar(db.select(db.func.count(User.id)).where(User.verified.is_(False))),
               "status_counts": _status_counts(Order.id > 0),
               "monthly": [{"month": m.strftime("%b %Y"), "amount": money(a), "orders": n} for m, a, n in monthly],
               "top_crops": [{"crop": c, "revenue": money(r)} for c, r in top]})


# ---------------------------------------------------------------- notifications

@bp.get("/notifications")
@login_required
def notifications(user):
    rows = db.session.scalars(db.select(Notification).where(Notification.user_id == user.id)
                              .order_by(Notification.created_at.desc()).limit(30)).all()
    unread = db.session.scalar(db.select(db.func.count(Notification.id)).where(
        Notification.user_id == user.id, Notification.read.is_(False)))
    return ok({"unread": unread, "items": [{"id": n.id, "title": n.title, "body": n.body, "link": n.link,
                                             "read": n.read, "at": n.created_at.isoformat()} for n in rows]})


@bp.post("/notifications/read")
@login_required
def mark_read(user):
    db.session.execute(db.update(Notification).where(Notification.user_id == user.id, Notification.read.is_(False))
                       .values(read=True))
    db.session.commit()
    return ok()


# ---------------------------------------------------------------- admin

def _enum_arg(enum_cls, value: str):
    try:
        return enum_cls(value.upper())
    except ValueError:
        raise APIError(f"Unknown status {value}")


@bp.get("/admin/users")
@roles_required(Role.ADMIN)
def admin_users(user):
    page, size = page_args()
    q = db.select(User).order_by(User.created_at.desc())
    if role := request.args.get("role"):
        try:
            q = q.where(User.role == Role(role.upper()))
        except ValueError:
            raise APIError("Unknown role")
    if term := request.args.get("q"):
        q = q.where(User.name.ilike(f"%{term}%") | User.email.ilike(f"%{term}%"))
    if request.args.get("unverified") == "1":
        q = q.where(User.verified.is_(False))
    return ok(paginated(q, page, size, user_private))


@bp.patch("/admin/users/<int:user_id>")
@roles_required(Role.ADMIN)
def admin_update_user(admin, user_id):
    u = db.session.get(User, user_id)
    if u is None:
        raise not_found("User")
    if u.id == admin.id:
        raise APIError("You can't change your own admin account here")
    data = body()
    if "verified" in data:
        u.verified = bool(data["verified"])
        if u.verified:
            notify(u.id, "Your account is verified", "Buyers now see a verified badge on your profile.")
    if "active" in data:
        u.active = bool(data["active"])
    db.session.commit()
    return ok(user_private(u))


@bp.get("/admin/listings")
@roles_required(Role.ADMIN)
def admin_listings(user):
    page, size = page_args()
    q = db.select(Listing).order_by(Listing.created_at.desc())
    if status := request.args.get("status"):
        q = q.where(Listing.status == _enum_arg(ListingStatus, status))
    return ok(paginated(q, page, size, listing_json))


@bp.patch("/admin/listings/<int:listing_id>")
@roles_required(Role.ADMIN)
def admin_moderate_listing(user, listing_id):
    l = db.session.get(Listing, listing_id)
    if l is None:
        raise not_found("Listing")
    data = body()
    hide = bool(data.get("hidden"))
    l.status = ListingStatus.HIDDEN if hide else (ListingStatus.ACTIVE if l.qty_available > 0 else ListingStatus.SOLD_OUT)
    if hide:
        notify(l.farmer_id, f"Your {l.crop} listing was hidden", str(data.get("reason", ""))[:300] or None)
    db.session.commit()
    return ok(listing_json(l))


@bp.get("/admin/orders")
@roles_required(Role.ADMIN)
def admin_orders(user):
    page, size = page_args()
    q = db.select(Order).order_by(Order.created_at.desc())
    if status := request.args.get("status"):
        q = q.where(Order.status == _enum_arg(S, status))
    return ok(paginated(q, page, size, lambda o: order_json(o, user)))
