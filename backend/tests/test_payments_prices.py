import hashlib
import hmac
import json

from app.extensions import db


def test_razorpay_signature_must_match(app, client, api, monkeypatch):
    """With Razorpay mode on, a forged checkout signature is rejected and the order stays unpaid."""
    farmer, buyer = api.register("FARMER"), api.register("BUYER")
    l = api.listing(farmer)
    oid = api.order(buyer, l["id"], 10, mode="PICKUP").json["id"]
    api.status(farmer, oid, "ACCEPTED")

    # Create the payment in demo mode, then switch to razorpay mode for verification.
    created = client.post(f"/api/v1/payments/orders/{oid}", headers=api.h(buyer)).json
    monkeypatch.setitem(app.config, "PAYMENT_MODE", "razorpay")
    monkeypatch.setitem(app.config, "RAZORPAY_KEY_SECRET", "test_secret")
    pid = "pay_TEST123"
    forged = client.post("/api/v1/payments/verify", headers=api.h(buyer), json={
        "razorpay_order_id": created["provider_order_id"], "razorpay_payment_id": pid, "razorpay_signature": "forged"})
    assert forged.status_code == 400
    assert client.get(f"/api/v1/orders/{oid}", headers=api.h(buyer)).json["payment_status"] == "FAILED"

    # Reopen the payment (as a retry would) and verify with a genuine HMAC signature.
    from app.models import Payment, PaymentStatus
    with app.app_context():
        p = db.session.scalar(db.select(Payment).where(Payment.order_id == oid))
        p.status = PaymentStatus.CREATED
        db.session.commit()
        order_ref = p.provider_order_id
    sig = hmac.new(b"test_secret", f"{order_ref}|{pid}".encode(), hashlib.sha256).hexdigest()
    ok = client.post("/api/v1/payments/verify", headers=api.h(buyer), json={
        "razorpay_order_id": order_ref, "razorpay_payment_id": pid, "razorpay_signature": sig})
    assert ok.status_code == 200
    assert client.get(f"/api/v1/orders/{oid}", headers=api.h(buyer)).json["payment_status"] == "PAID"


def test_webhook_requires_valid_signature_and_is_idempotent(app, client, api, monkeypatch):
    monkeypatch.setitem(app.config, "RAZORPAY_WEBHOOK_SECRET", "whsec")
    farmer, buyer = api.register("FARMER"), api.register("BUYER")
    l = api.listing(farmer)
    oid = api.order(buyer, l["id"], 10, mode="PICKUP").json["id"]
    api.status(farmer, oid, "ACCEPTED")
    created = client.post(f"/api/v1/payments/orders/{oid}", headers=api.h(buyer)).json
    payload = json.dumps({"event": "payment.captured", "payload": {"payment": {"entity": {
        "id": "pay_WH1", "order_id": created["provider_order_id"], "amount": created["amount"]}}}}).encode()

    bad = client.post("/api/v1/payments/webhook", data=payload, headers={"X-Razorpay-Signature": "nope"},
                      content_type="application/json")
    assert bad.status_code == 400
    sig = hmac.new(b"whsec", payload, hashlib.sha256).hexdigest()
    for _ in range(2):  # replay is harmless
        r = client.post("/api/v1/payments/webhook", data=payload, headers={"X-Razorpay-Signature": sig},
                        content_type="application/json")
        assert r.status_code == 200
    order = client.get(f"/api/v1/orders/{oid}", headers=api.h(buyer)).json
    assert order["payment_status"] == "PAID"
    assert sum("Payment of" in (e["note"] or "") for e in order["events"]) == 1


def _pickup_order(client, api):
    farmer, buyer = api.register("FARMER"), api.register("BUYER")
    l = api.listing(farmer)
    oid = api.order(buyer, l["id"], 10, mode="PICKUP").json["id"]
    api.status(farmer, oid, "ACCEPTED")
    return farmer, buyer, oid


def _extra_payment(app, oid, ref):
    """A second open checkout for the same order, as a buyer with two tabs would create."""
    from app.models import Order, Payment
    with app.app_context():
        order = db.session.get(Order, oid)
        db.session.add(Payment(order_id=oid, provider="demo", provider_order_id=ref, amount=order.total))
        db.session.commit()


def test_payment_after_cancellation_is_refunded(client, api):
    farmer, buyer, oid = _pickup_order(client, api)
    created = client.post(f"/api/v1/payments/orders/{oid}", headers=api.h(buyer)).json
    assert api.status(farmer, oid, "CANCELLED").status_code == 200  # while the buyer is in checkout
    r = client.post("/api/v1/payments/verify", headers=api.h(buyer),
                    json={"razorpay_order_id": created["provider_order_id"], "demo_confirm": True})
    assert r.status_code == 200 and r.json["payment_status"] == "REFUNDED"
    order = client.get(f"/api/v1/orders/{oid}", headers=api.h(buyer)).json
    assert order["status"] == "CANCELLED" and order["payment_status"] == "REFUNDED"


def test_second_payment_for_a_paid_order_is_refunded(app, client, api):
    _, buyer, oid = _pickup_order(client, api)
    api.pay(buyer, oid)
    _extra_payment(app, oid, "demo_order_second")
    r = client.post("/api/v1/payments/verify", headers=api.h(buyer),
                    json={"razorpay_order_id": "demo_order_second", "demo_confirm": True})
    assert r.json["payment_status"] == "REFUNDED"
    assert client.get(f"/api/v1/orders/{oid}", headers=api.h(buyer)).json["payment_status"] == "PAID"


def test_failed_webhook_does_not_overwrite_a_paid_order(app, client, api, monkeypatch):
    monkeypatch.setitem(app.config, "RAZORPAY_WEBHOOK_SECRET", "whsec")
    _, buyer, oid = _pickup_order(client, api)
    api.pay(buyer, oid)
    _extra_payment(app, oid, "order_abandoned")
    payload = json.dumps({"event": "payment.failed", "payload": {"payment": {"entity": {
        "id": "pay_F1", "order_id": "order_abandoned"}}}}).encode()
    sig = hmac.new(b"whsec", payload, hashlib.sha256).hexdigest()
    r = client.post("/api/v1/payments/webhook", data=payload, headers={"X-Razorpay-Signature": sig},
                    content_type="application/json")
    assert r.status_code == 200
    assert client.get(f"/api/v1/orders/{oid}", headers=api.h(buyer)).json["payment_status"] == "PAID"


def test_amount_comes_from_server(client, api):
    farmer, buyer = api.register("FARMER"), api.register("BUYER")
    l = api.listing(farmer, price=12.5)
    oid = api.order(buyer, l["id"], 8, mode="PICKUP").json["id"]
    api.status(farmer, oid, "ACCEPTED")
    r = client.post(f"/api/v1/payments/orders/{oid}", headers=api.h(buyer), json={"amount": 1})
    assert r.json["amount"] == 10000  # 8 x 12.50 = ₹100.00 = 10000 paise


def test_price_reference(app, client, api):
    from app.cli import generate_sample_prices
    with app.app_context():
        generate_sample_prices(days=30)
    farmer = api.register("FARMER")
    api.listing(farmer, crop="Tomato", price=15)
    board = client.get("/api/v1/prices/board").json
    assert board[0]["crop"] == "Tomato" and board[0]["market_median"] is not None
    series = client.get("/api/v1/prices?commodity=tomato").json
    assert series["series"] and series["markets"] and series["unit"] == "kg"
