import pytest

from app import create_app
from app.config import TestConfig
from app.extensions import db


@pytest.fixture(scope="session")
def app():
    app = create_app(TestConfig)
    with app.app_context():
        db.drop_all()
        db.create_all()
    yield app
    with app.app_context():
        db.drop_all()


@pytest.fixture(autouse=True)
def clean_db(app):
    yield
    with app.app_context():
        db.session.remove()
        tables = ", ".join(t.name for t in reversed(db.metadata.sorted_tables))
        db.session.execute(db.text(f"TRUNCATE {tables} RESTART IDENTITY CASCADE"))
        db.session.commit()


@pytest.fixture
def client(app):
    return app.test_client()


class Api:
    def __init__(self, client):
        self.c = client

    def register(self, role, name=None, **extra):
        name = name or f"{role.title()} User"
        email = f"{name.lower().replace(' ', '.')}@test.in"
        r = self.c.post("/api/v1/auth/register", json={"name": name, "email": email, "password": "password123",
                                                       "role": role, "phone": "+91 9876543210", **extra})
        assert r.status_code == 201, r.json
        return {"Authorization": f"Bearer {r.json['access_token']}", "_id": r.json["user"]["id"]}

    def h(self, auth):
        return {k: v for k, v in auth.items() if not k.startswith("_")}

    def listing(self, farmer, **kw):
        data = {"crop": "Tomato", "qty_total": 100, "price": 20, "location": "Villupuram", "min_order_qty": 1, **kw}
        r = self.c.post("/api/v1/listings", json=data, headers=self.h(farmer))
        assert r.status_code == 201, r.json
        return r.json

    def order(self, buyer, listing_id, qty, mode="DELIVERY", key=None):
        headers = self.h(buyer) | ({"Idempotency-Key": key} if key else {})
        return self.c.post("/api/v1/orders", headers=headers, json={
            "items": [{"listing_id": listing_id, "qty": qty}], "delivery_mode": mode,
            "delivery_address": "1 Test St, Puducherry"})

    def status(self, who, order_id, status):
        return self.c.patch(f"/api/v1/orders/{order_id}/status", json={"status": status}, headers=self.h(who))

    def pay(self, buyer, order_id):
        r = self.c.post(f"/api/v1/payments/orders/{order_id}", headers=self.h(buyer))
        assert r.status_code == 201, r.json
        r = self.c.post("/api/v1/payments/verify", headers=self.h(buyer),
                        json={"razorpay_order_id": r.json["provider_order_id"], "demo_confirm": True})
        assert r.status_code == 200, r.json
        return r


@pytest.fixture
def api(client):
    return Api(client)
