"""Payments via Razorpay (test or live keys), with a clearly-labelled demo mode when no keys are set.

Security rules followed here:
  * The amount always comes from the server-side order total, never from the client.
  * A payment is marked PAID only after verifying Razorpay's HMAC signature
    (checkout callback) or the webhook signature — never because the browser says so.
  * Every handler is idempotent: replays of the same callback/webhook are harmless.
"""
from __future__ import annotations

import hashlib
import hmac
import json
import uuid
from decimal import Decimal

from flask import Blueprint, current_app, request

from .common import APIError, body, forbidden, money, not_found, notify, ok, roles_required
from .extensions import db, limiter
from .models import (
    DeliveryMode, Order, OrderEvent, OrderStatus as S, Payment, PaymentStatus, Role, User,
)

bp = Blueprint("payments", __name__, url_prefix="/api/v1/payments")


def _client():
    import razorpay
    cfg = current_app.config
    return razorpay.Client(auth=(cfg["RAZORPAY_KEY_ID"], cfg["RAZORPAY_KEY_SECRET"]))


def _mode() -> str:
    return current_app.config["PAYMENT_MODE"]


def paise(amount: Decimal) -> int:
    return int((amount * 100).quantize(Decimal("1")))


def _payable(order: Order) -> bool:
    if order.payment_status == PaymentStatus.PAID:
        return False
    if order.delivery_mode == DeliveryMode.PICKUP:
        return order.status == S.ACCEPTED
    return order.status == S.TRANSPORT_ASSIGNED


def _mark_paid(payment: Payment, provider_payment_id: str | None, actor_id: int | None, via: str):
    """Idempotent: safe to call from both the checkout callback and the webhook."""
    order = db.session.scalar(db.select(Order).where(Order.id == payment.order_id).with_for_update())
    if payment.status == PaymentStatus.PAID:
        return order
    payment.status = PaymentStatus.PAID
    payment.provider_payment_id = provider_payment_id or payment.provider_payment_id
    order.payment_status = PaymentStatus.PAID
    order.events.append(OrderEvent(from_status=order.status.value, to_status=order.status.value, actor_id=actor_id,
                                   note=f"Payment of ₹{payment.amount:,.2f} received ({via})"))
    for uid in {order.farmer_id, order.transporter_id} - {None}:
        notify(uid, f"Order #{order.id} is paid", f"₹{payment.amount:,.2f} received", f"/orders/{order.id}")
    return order


@bp.get("/config")
def config():
    return ok({"mode": _mode(), "key_id": current_app.config["RAZORPAY_KEY_ID"] if _mode() == "razorpay" else None})


@bp.post("/orders/<int:order_id>")
@roles_required(Role.BUYER)
@limiter.limit("30 per hour")
def create_payment(user: User, order_id: int):
    order = db.session.scalar(db.select(Order).where(Order.id == order_id).with_for_update())
    if order is None or order.buyer_id != user.id:
        raise not_found("Order")
    if not _payable(order):
        if order.payment_status == PaymentStatus.PAID:
            raise APIError("This order is already paid", 409, "already_paid")
        raise APIError("This order isn't ready for payment yet", 409, "not_payable")
    amount = order.total

    # Reuse an open payment for the same amount (user closed the checkout and retried).
    payment = db.session.scalar(db.select(Payment).where(
        Payment.order_id == order.id, Payment.status == PaymentStatus.CREATED, Payment.amount == amount))
    if payment is None:
        if _mode() == "razorpay":
            try:
                rp = _client().order.create({
                    "amount": paise(amount), "currency": "INR", "receipt": f"farmfresh-{order.id}-{uuid.uuid4().hex[:8]}",
                    "notes": {"farmfresh_order_id": str(order.id)},
                })
            except Exception as e:  # network / auth errors from the gateway
                current_app.logger.exception("Razorpay order create failed")
                raise APIError(f"Payment gateway error: {e}", 502, "gateway_error")
            provider_order_id = rp["id"]
        else:
            provider_order_id = f"demo_order_{uuid.uuid4().hex[:14]}"
        payment = Payment(order_id=order.id, provider=_mode(), provider_order_id=provider_order_id, amount=amount)
        db.session.add(payment)
    order.payment_status = PaymentStatus.CREATED
    db.session.commit()
    return ok({
        "mode": _mode(), "key_id": current_app.config["RAZORPAY_KEY_ID"] if _mode() == "razorpay" else None,
        "provider_order_id": payment.provider_order_id, "amount": paise(amount), "amount_display": money(amount),
        "currency": "INR", "order_id": order.id,
        "prefill": {"name": user.name, "email": user.email, "contact": user.phone or ""},
    }, 201)


def verify_checkout_signature(provider_order_id: str, provider_payment_id: str, signature: str) -> bool:
    secret = current_app.config["RAZORPAY_KEY_SECRET"].encode()
    expected = hmac.new(secret, f"{provider_order_id}|{provider_payment_id}".encode(), hashlib.sha256).hexdigest()
    return hmac.compare_digest(expected, signature or "")


@bp.post("/verify")
@roles_required(Role.BUYER)
def verify(user: User):
    data = body()
    provider_order_id = str(data.get("razorpay_order_id", ""))
    payment = db.session.scalar(db.select(Payment).where(Payment.provider_order_id == provider_order_id))
    if payment is None:
        raise not_found("Payment")
    order = db.session.get(Order, payment.order_id)
    if order.buyer_id != user.id:
        raise forbidden()
    if _mode() == "razorpay":
        pid, sig = str(data.get("razorpay_payment_id", "")), str(data.get("razorpay_signature", ""))
        if not verify_checkout_signature(provider_order_id, pid, sig):
            payment.status = PaymentStatus.FAILED
            order.payment_status = PaymentStatus.FAILED
            db.session.commit()
            raise APIError("Payment signature didn't match. You have not been charged twice; try again.", 400,
                           "bad_signature")
        _mark_paid(payment, pid, user.id, "Razorpay")
    else:
        if not data.get("demo_confirm"):
            raise APIError("Demo payments need demo_confirm")
        _mark_paid(payment, f"demo_pay_{uuid.uuid4().hex[:14]}", user.id, "demo checkout")
    db.session.commit()
    return ok({"ok": True, "order_id": order.id, "payment_status": "PAID"})


@bp.post("/failed")
@roles_required(Role.BUYER)
def failed(user: User):
    """The checkout reported a failure; record it so the buyer can retry."""
    data = body()
    payment = db.session.scalar(db.select(Payment).where(Payment.provider_order_id == str(data.get("razorpay_order_id", ""))))
    if payment is None:
        raise not_found("Payment")
    order = db.session.get(Order, payment.order_id)
    if order.buyer_id != user.id:
        raise forbidden()
    if payment.status == PaymentStatus.CREATED:
        payment.status = PaymentStatus.FAILED
        order.payment_status = PaymentStatus.FAILED
        reason = str(data.get("reason", ""))[:200] or "Payment failed"
        order.events.append(OrderEvent(from_status=order.status.value, to_status=order.status.value,
                                       actor_id=user.id, note=f"Payment failed: {reason}"))
        db.session.commit()
    return ok({"ok": True})


@bp.post("/webhook")
@limiter.exempt
def webhook():
    secret = current_app.config["RAZORPAY_WEBHOOK_SECRET"]
    if not secret:
        raise APIError("Webhook not configured", 404, "not_found")
    raw = request.get_data()
    sig = request.headers.get("X-Razorpay-Signature", "")
    expected = hmac.new(secret.encode(), raw, hashlib.sha256).hexdigest()
    if not hmac.compare_digest(expected, sig):
        raise APIError("Invalid signature", 400, "bad_signature")
    event = json.loads(raw)
    etype = event.get("event", "")
    payload = event.get("payload", {})

    if etype in ("payment.captured", "order.paid"):
        ent = payload.get("payment", {}).get("entity", {})
        payment = db.session.scalar(db.select(Payment).where(Payment.provider_order_id == ent.get("order_id")))
        if payment and paise(payment.amount) == ent.get("amount"):
            _mark_paid(payment, ent.get("id"), None, "Razorpay webhook")
    elif etype == "payment.failed":
        ent = payload.get("payment", {}).get("entity", {})
        payment = db.session.scalar(db.select(Payment).where(Payment.provider_order_id == ent.get("order_id")))
        if payment and payment.status == PaymentStatus.CREATED:
            payment.status = PaymentStatus.FAILED
            db.session.get(Order, payment.order_id).payment_status = PaymentStatus.FAILED
    elif etype == "refund.processed":
        ent = payload.get("refund", {}).get("entity", {})
        payment = db.session.scalar(db.select(Payment).where(Payment.provider_payment_id == ent.get("payment_id")))
        if payment and payment.status != PaymentStatus.REFUNDED:
            payment.status = PaymentStatus.REFUNDED
            db.session.get(Order, payment.order_id).payment_status = PaymentStatus.REFUNDED
    db.session.commit()
    return ok({"ok": True})


def refund_order(order: Order, actor: User):
    """Called inside a cancellation transaction for a paid order."""
    payment = db.session.scalar(db.select(Payment).where(
        Payment.order_id == order.id, Payment.status == PaymentStatus.PAID))
    if payment is None:
        return
    if payment.provider == "razorpay":
        try:
            r = _client().payment.refund(payment.provider_payment_id, {"amount": paise(payment.amount),
                                                                      "notes": {"farmfresh_order_id": str(order.id)}})
        except Exception as e:
            current_app.logger.exception("Razorpay refund failed")
            raise APIError(f"Refund failed at the gateway, order not cancelled: {e}", 502, "gateway_error")
        payment.provider_refund_id = r.get("id")
        payment.status = PaymentStatus.REFUNDED if r.get("status") == "processed" else PaymentStatus.REFUND_PENDING
    else:
        payment.provider_refund_id = f"demo_rfnd_{uuid.uuid4().hex[:14]}"
        payment.status = PaymentStatus.REFUNDED
    order.payment_status = payment.status
    order.events.append(OrderEvent(from_status=order.status.value, to_status=order.status.value, actor_id=actor.id,
                                   note=f"Refund of ₹{payment.amount:,.2f} {'issued' if payment.status == PaymentStatus.REFUNDED else 'initiated'}"))
