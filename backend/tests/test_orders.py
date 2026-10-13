from decimal import Decimal


def _stock(client, listing_id):
    return Decimal(client.get(f"/api/v1/listings/{listing_id}").json["qty_available"])


def test_full_delivery_lifecycle(client, api):
    farmer = api.register("FARMER")
    buyer = api.register("BUYER")
    trans = api.register("TRANSPORTER", vehicle_capacity_kg=1000, service_area="Villupuram")
    l = api.listing(farmer, qty_total=100, price=20)

    r = api.order(buyer, l["id"], 40)
    assert r.status_code == 201
    oid = r.json["id"]
    assert r.json["subtotal"] == "800.00" and r.json["status"] == "PENDING"
    assert _stock(client, l["id"]) == 60  # reserved at order time

    assert api.status(farmer, oid, "ACCEPTED").status_code == 200

    jobs = client.get("/api/v1/transport/jobs", headers=api.h(trans)).json
    assert jobs[0]["id"] == oid and jobs[0]["match"]["fits_vehicle"] and jobs[0]["match"]["in_service_area"]
    q = client.post(f"/api/v1/transport/jobs/{oid}/quotes", headers=api.h(trans),
                    json={"fee": 500, "eta_hours": 6, "vehicle_type": "Mini truck"})
    assert q.status_code == 201
    acc = client.post(f"/api/v1/transport/quotes/{q.json['id']}/accept", headers=api.h(buyer))
    assert acc.status_code == 200 and acc.json["status"] == "TRANSPORT_ASSIGNED" and acc.json["total"] == "1300.00"

    # Can't dispatch before payment
    r = api.status(trans, oid, "DISPATCHED")
    assert r.status_code == 409 and "paid" in r.json["error"]["message"]
    api.pay(buyer, oid)
    assert api.status(trans, oid, "DISPATCHED").status_code == 200
    assert api.status(buyer, oid, "COMPLETED").status_code == 409  # must be delivered first
    assert api.status(trans, oid, "DELIVERED").status_code == 200
    done = api.status(buyer, oid, "COMPLETED")
    assert done.status_code == 200 and done.json["payment_status"] == "PAID"
    assert [e["to"] for e in done.json["events"]] == [
        "PENDING", "ACCEPTED", "TRANSPORT_ASSIGNED", "TRANSPORT_ASSIGNED", "DISPATCHED", "DELIVERED", "COMPLETED"]

    rv = client.post(f"/api/v1/orders/{oid}/review", headers=api.h(buyer), json={"rating": 5, "comment": "Great"})
    assert rv.status_code == 201
    assert client.post(f"/api/v1/orders/{oid}/review", headers=api.h(buyer), json={"rating": 4}).status_code == 409


def test_pickup_flow(client, api):
    farmer, buyer = api.register("FARMER"), api.register("BUYER")
    l = api.listing(farmer)
    oid = api.order(buyer, l["id"], 10, mode="PICKUP").json["id"]
    api.status(farmer, oid, "ACCEPTED")
    assert api.status(farmer, oid, "DELIVERED").status_code == 409  # unpaid
    api.pay(buyer, oid)
    assert api.status(farmer, oid, "DELIVERED").status_code == 200
    assert api.status(buyer, oid, "COMPLETED").status_code == 200


def test_reject_releases_stock(client, api):
    farmer, buyer = api.register("FARMER"), api.register("BUYER")
    l = api.listing(farmer, qty_total=50)
    oid = api.order(buyer, l["id"], 50).json["id"]
    assert client.get(f"/api/v1/listings/{l['id']}").json["status"] == "SOLD_OUT"
    assert api.status(farmer, oid, "REJECTED").status_code == 200
    listing = client.get(f"/api/v1/listings/{l['id']}").json
    assert listing["qty_available"] == "50.00" and listing["status"] == "ACTIVE"


def test_cancel_after_payment_refunds(client, api):
    farmer, buyer = api.register("FARMER"), api.register("BUYER")
    l = api.listing(farmer)
    oid = api.order(buyer, l["id"], 10, mode="PICKUP").json["id"]
    api.status(farmer, oid, "ACCEPTED")
    api.pay(buyer, oid)
    r = api.status(buyer, oid, "CANCELLED")
    assert r.status_code == 200 and r.json["payment_status"] == "REFUNDED"
    assert _stock(client, l["id"]) == 100


def test_illegal_transitions_and_permissions(client, api):
    farmer, buyer, other = api.register("FARMER"), api.register("BUYER"), api.register("BUYER", "Other Buyer")
    l = api.listing(farmer)
    oid = api.order(buyer, l["id"], 5).json["id"]
    assert api.status(buyer, oid, "ACCEPTED").status_code == 403       # buyer can't accept
    assert api.status(other, oid, "CANCELLED").status_code == 404      # can't even see others' orders
    assert api.status(farmer, oid, "COMPLETED").status_code == 409     # can't skip states
    assert api.status(farmer, oid, "TRANSPORT_ASSIGNED").status_code == 409
    api.status(farmer, oid, "REJECTED")
    assert api.status(farmer, oid, "ACCEPTED").status_code == 409      # terminal
    assert client.post(f"/api/v1/payments/orders/{oid}", headers=api.h(buyer)).status_code == 409


def test_order_validation(client, api):
    f1, f2, buyer = api.register("FARMER", "F One"), api.register("FARMER", "F Two"), api.register("BUYER")
    a = api.listing(f1, min_order_qty=10)
    b = api.listing(f2)
    assert api.order(buyer, a["id"], 5).status_code == 422             # below minimum
    assert api.order(buyer, a["id"], 101).status_code == 409           # more than stock
    mixed = client.post("/api/v1/orders", headers=api.h(buyer), json={
        "items": [{"listing_id": a["id"], "qty": 10}, {"listing_id": b["id"], "qty": 1}], "delivery_address": "x"})
    assert mixed.status_code == 400                                    # one farmer per order
    assert _stock(client, a["id"]) == 100                              # failed orders reserve nothing


def test_idempotency_key_prevents_duplicate_orders(client, api):
    farmer, buyer = api.register("FARMER"), api.register("BUYER")
    l = api.listing(farmer)
    r1 = api.order(buyer, l["id"], 10, key="abc-123")
    r2 = api.order(buyer, l["id"], 10, key="abc-123")
    assert r1.json["id"] == r2.json["id"]
    assert _stock(client, l["id"]) == 90


def test_contact_details_hidden_until_accepted(client, api):
    farmer, buyer = api.register("FARMER"), api.register("BUYER")
    l = api.listing(farmer)
    oid = api.order(buyer, l["id"], 5).json["id"]
    pending = client.get(f"/api/v1/orders/{oid}", headers=api.h(farmer)).json
    assert pending["delivery_address"] is None and "phone" not in pending["buyer"]
    api.status(farmer, oid, "ACCEPTED")
    accepted = client.get(f"/api/v1/orders/{oid}", headers=api.h(farmer)).json
    assert accepted["delivery_address"] and accepted["buyer"]["phone"]
