"""Overselling test: many buyers race for the same last units of stock.

Each request runs in its own thread with its own database connection, exactly like
concurrent gunicorn workers. Row locking (SELECT ... FOR UPDATE) must guarantee that
the sum of successful orders never exceeds the stock.
"""
import threading
from decimal import Decimal


def _race(app, api, stock, n_buyers, qty_each):
    farmer = api.register("FARMER")
    buyers = [api.register("BUYER", f"Racer {i}") for i in range(n_buyers)]
    listing = api.listing(farmer, qty_total=stock)
    barrier = threading.Barrier(n_buyers)
    results = []

    def attempt(b):
        client = app.test_client()
        barrier.wait()  # release all requests at the same instant
        r = client.post("/api/v1/orders", headers=api.h(b), json={
            "items": [{"listing_id": listing["id"], "qty": qty_each}], "delivery_mode": "PICKUP"})
        results.append(r.status_code)

    threads = [threading.Thread(target=attempt, args=(b,)) for b in buyers]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    left = Decimal(app.test_client().get(f"/api/v1/listings/{listing['id']}").json["qty_available"])
    return results, left


def test_last_stock_sold_exactly_once(app, api):
    results, left = _race(app, api, stock=5, n_buyers=10, qty_each=5)
    assert results.count(201) == 1
    assert results.count(409) == 9
    assert left == 0


def test_partial_stock_never_oversold(app, api):
    results, left = _race(app, api, stock=10, n_buyers=16, qty_each=1)
    assert results.count(201) == 10
    assert left == 0
