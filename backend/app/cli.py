"""Flask CLI commands: seed demo data, generate sample prices, import real mandi prices, create an admin."""
from __future__ import annotations

import json
import math
import os
import random
import urllib.parse
import urllib.request
from datetime import datetime, timedelta, timezone
from decimal import Decimal

import click

from .extensions import db
from .models import (
    DeliveryMode, Listing, Order, OrderEvent, OrderItem, OrderStatus as S, Payment, PaymentStatus, PriceRecord,
    QuoteStatus, Review, Role, TransportQuote, User,
)

# Base modal prices (INR per quintal) used only to generate clearly-labelled sample reference data.
SAMPLE_BASE = {
    "Tomato": 1900, "Onion": 2600, "Potato": 2300, "Brinjal": 2400, "Carrot": 3600, "Beans": 4800,
    "Banana": 2900, "Mango": 5200, "Okra": 3100, "Cabbage": 1500, "Green Chilli": 4200, "Cauliflower": 2700,
    "Drumstick": 6500, "Coconut": 3800, "Paddy": 2300,
}
MARKETS = [("Koyambedu", "Tamil Nadu"), ("Oddanchatram", "Tamil Nadu"), ("Puducherry", "Puducherry"),
           ("Madurai", "Tamil Nadu"), ("Coimbatore", "Tamil Nadu"), ("Hosur", "Tamil Nadu"),
           ("Villupuram", "Tamil Nadu"), ("Tiruchirappalli", "Tamil Nadu")]

DEMO_PASSWORD = "farmfresh123"


def generate_sample_prices(days: int = 120):
    rnd = random.Random(42)
    today = datetime.now(timezone.utc).replace(hour=0, minute=0, second=0, microsecond=0)
    db.session.execute(db.delete(PriceRecord).where(PriceRecord.source == "sample"))
    rows = []
    for ci, (crop, base) in enumerate(SAMPLE_BASE.items()):
        phase = rnd.random() * math.tau
        for mi, (market, state) in enumerate(MARKETS):
            if rnd.random() < 0.2:
                continue  # not every market trades every crop
            mkt_bias = 1 + (rnd.random() - 0.5) * 0.18
            for d in range(days, -1, -1):
                if rnd.random() < 0.12:
                    continue  # market holidays / missing reports
                t = days - d
                seasonal = 1 + 0.18 * math.sin(t / 40 + phase)
                noise = 1 + (rnd.random() - 0.5) * 0.08
                modal = round(base * mkt_bias * seasonal * noise / 10) * 10
                spread = modal * (0.12 + rnd.random() * 0.08)
                rows.append(PriceRecord(
                    commodity=crop, market=market, state=state, date=today - timedelta(days=d),
                    modal_price=Decimal(modal), min_price=Decimal(round(modal - spread)),
                    max_price=Decimal(round(modal + spread * 0.9)), source="sample"))
    db.session.add_all(rows)
    db.session.commit()
    return len(rows)


def _user(name, email, role, **kw):
    from .auth import hash_password
    u = User(name=name, email=email, role=role, password_hash=hash_password(DEMO_PASSWORD), **kw)
    db.session.add(u)
    return u


def seed_demo(with_admin: bool = True):
    """Demo users share a public password, so a public deploy must not get the demo admin."""
    rnd = random.Random(7)
    if with_admin:
        _user("Platform Admin", "admin@farmfresh.demo", Role.ADMIN, verified=True, phone="+91 90000 00000")
    farmers = [
        _user("Murugan Selvam", "farmer@farmfresh.demo", Role.FARMER, verified=True, phone="+91 94430 11111",
              location="Villupuram, Tamil Nadu", farm_name="Selvam Family Farm"),
        _user("Lakshmi Devi", "lakshmi@farmfresh.demo", Role.FARMER, verified=True, phone="+91 94430 22222",
              location="Oddanchatram, Tamil Nadu", farm_name="Thottam Organics"),
        _user("Arul Prakash", "arul@farmfresh.demo", Role.FARMER, verified=False, phone="+91 94430 33333",
              location="Bahour, Puducherry", farm_name="Bahour Green Fields"),
        _user("Kavitha Raman", "kavitha@farmfresh.demo", Role.FARMER, verified=True, phone="+91 94430 44444",
              location="Hosur, Tamil Nadu", farm_name="Hosur Highland Farms"),
    ]
    buyers = [
        _user("Anand Kumar", "buyer@farmfresh.demo", Role.BUYER, verified=True, phone="+91 98400 55555",
              location="Puducherry", business_type="Restaurant"),
        _user("Fresh Basket Stores", "freshbasket@farmfresh.demo", Role.BUYER, verified=True, phone="+91 98400 66666",
              location="Chennai", business_type="Retailer"),
        _user("Priya S", "priya@farmfresh.demo", Role.BUYER, phone="+91 98400 77777", location="Chennai",
              business_type="Household"),
    ]
    transporters = [
        _user("Ravi Logistics", "transport@farmfresh.demo", Role.TRANSPORTER, verified=True, phone="+91 97890 88888",
              location="Villupuram", vehicle_type="Tata Ace (mini truck)", vehicle_capacity_kg=750,
              service_area="Villupuram, Puducherry, Bahour, Chennai"),
        _user("Kongu Cold Movers", "kongu@farmfresh.demo", Role.TRANSPORTER, verified=True, phone="+91 97890 99999",
              location="Coimbatore", vehicle_type="Reefer truck", vehicle_capacity_kg=4000,
              service_area="Oddanchatram, Coimbatore, Madurai, Hosur, Chennai"),
    ]
    db.session.flush()

    catalogue = [  # (farmer index, crop, variety, grade, qty, organic, description)
        (0, "Tomato", "Hybrid", "A", 800, False, "Firm, deep red, picked this morning. Good for restaurants."),
        (0, "Brinjal", "Green long", "A", 300, False, "Tender, few seeds. Sorted and crated."),
        (0, "Drumstick", "PKM-1", "A", 150, False, "Long, fleshy pods from our own trees."),
        (0, "Paddy", "Ponni", "A", 2000, False, "Sun-dried Ponni paddy, moisture under 14%."),
        (1, "Carrot", "Ooty", "A", 400, True, "Organic certified. Sweet and crunchy."),
        (1, "Beans", "French", "A", 250, True, "Stringless French beans, organic."),
        (1, "Banana", "Nendran", "B", 600, False, "Nendran bunches, ideal for chips and steaming."),
        (1, "Green Chilli", "G4", "A", 120, False, "Spicy G4 chilli, freshly harvested."),
        (2, "Okra", "Arka Anamika", "A", 200, False, "Young, tender pods, harvested every two days."),
        (2, "Coconut", "Tall", "A", 900, False, "Mature coconuts, husked. Sold by kg."),
        (2, "Mango", "Banganapalli", "A", 350, False, "Naturally ripened, no carbide."),
        (3, "Cabbage", "Green", "A", 1200, False, "Dense heads from cool Hosur climate."),
        (3, "Cauliflower", "Snowball", "B", 500, False, "White curds, slight discoloration on a few."),
        (3, "Potato", "Kufri Jyoti", "A", 1500, False, "Clean, medium-large size."),
        (3, "Onion", "Bellary", "A", 1000, False, "Bellary onions, cured for storage."),
    ]
    from .prices import market_reference  # noqa: F401 (uses g; called under app context)
    listings = []
    now = datetime.now(timezone.utc)
    for fi, crop, variety, grade, qty, organic, desc in catalogue:
        base = Decimal(SAMPLE_BASE[crop]) / 100
        factor = Decimal(str(round(0.85 + rnd.random() * 0.3, 2))) * (Decimal("1.15") if organic else 1)
        price = (base * factor).quantize(Decimal("0.5"))
        f = farmers[fi]
        l = Listing(farmer_id=f.id, crop=crop, variety=variety, grade=grade, unit="kg", qty_total=Decimal(qty),
                    qty_available=Decimal(qty), min_order_qty=Decimal(10 if qty < 500 else 25), price=price,
                    location=f.location, harvest_date=now - timedelta(days=rnd.randint(0, 3)), description=desc,
                    organic=organic, created_at=now - timedelta(hours=rnd.randint(1, 96)))
        db.session.add(l)
        listings.append(l)
    db.session.flush()

    # Order history over the last ~5 months so dashboards have real numbers to show.
    def add_order(listing, buyer, qty, status, days_ago, transporter=None, fee=Decimal(0), rating=None):
        created = now - timedelta(days=days_ago, hours=rnd.randint(0, 20))
        qty = Decimal(qty)
        listing.qty_total += qty  # history is "already sold" stock on top of what's available now
        mode = DeliveryMode.DELIVERY if transporter else DeliveryMode.PICKUP
        o = Order(buyer_id=buyer.id, farmer_id=listing.farmer_id, transporter_id=transporter.id if transporter else None,
                  status=status, delivery_mode=mode, delivery_address=f"{buyer.name}, {buyer.location}" if transporter else None,
                  subtotal=(qty * listing.price).quantize(Decimal("0.01")), transport_fee=fee, created_at=created,
                  updated_at=created + timedelta(days=1))
        o.items.append(OrderItem(listing_id=listing.id, qty=qty, agreed_unit_price=listing.price,
                                 crop_snapshot=f"{listing.crop} ({listing.variety})", unit_snapshot="kg"))
        path = {S.COMPLETED: [S.PENDING, S.ACCEPTED] + ([S.TRANSPORT_ASSIGNED, S.DISPATCHED] if transporter else []) + [S.DELIVERED, S.COMPLETED],
                S.REJECTED: [S.PENDING, S.REJECTED]}[status]
        prev = None
        for i, st in enumerate(path):
            o.events.append(OrderEvent(from_status=prev, to_status=st.value, at=created + timedelta(hours=6 * i)))
            prev = st.value
        db.session.add(o)
        db.session.flush()
        if status == S.COMPLETED:
            o.payment_status = PaymentStatus.PAID
            db.session.add(Payment(order_id=o.id, provider="demo", provider_order_id=f"demo_hist_{o.id}",
                                   provider_payment_id=f"demo_pay_hist_{o.id}", amount=o.total,
                                   status=PaymentStatus.PAID, created_at=created))
            if transporter:
                db.session.add(TransportQuote(order_id=o.id, transporter_id=transporter.id, fee=fee,
                                              vehicle_type=transporter.vehicle_type, eta_hours=8, status=QuoteStatus.ACCEPTED))
            if rating:
                db.session.add(Review(order_id=o.id, reviewer_id=buyer.id, farmer_id=listing.farmer_id, rating=rating,
                                      comment=rnd.choice(["Fresh and well packed.", "Exactly as described.",
                                                          "Good quality, will order again.", "Arrived on time, great produce.",
                                                          "Slightly smaller than expected but fresh."]),
                                      created_at=created + timedelta(days=2)))
        return o

    for _ in range(46):
        l = rnd.choice(listings)
        b = rnd.choice(buyers)
        t = rnd.choice([None, transporters[0], transporters[1]])
        fee = Decimal(rnd.choice([350, 450, 600, 800, 1200])) if t else Decimal(0)
        status = S.COMPLETED if rnd.random() > 0.1 else S.REJECTED
        add_order(l, b, rnd.choice([20, 25, 40, 50, 75, 100, 150]), status, rnd.randint(3, 150), t, fee,
                  rating=rnd.choice([5, 5, 4, 4, 4, 3]) if rnd.random() > 0.3 else None)

    # A few live orders in different states so every dashboard has something to act on.
    from .orders import create_order
    db.session.commit()
    live1 = create_order(buyers[0], [{"listing_id": listings[0].id, "qty": 50}], delivery_mode=DeliveryMode.DELIVERY,
                         address="12 Mission Street, Puducherry", note="Need by Friday morning", idempotency_key=None)
    live2 = create_order(buyers[1], [{"listing_id": listings[4].id, "qty": 40}, {"listing_id": listings[5].id, "qty": 30}],
                         delivery_mode=DeliveryMode.DELIVERY, address="Fresh Basket, Anna Nagar, Chennai", note=None,
                         idempotency_key=None)
    from .orders import transition
    transition(live2.id, S.ACCEPTED, farmers[1], note="Packed and ready")
    db.session.add(TransportQuote(order_id=live2.id, transporter_id=transporters[1].id, fee=Decimal("1450"),
                                  vehicle_type="Reefer truck", eta_hours=10, note="Cold chain, overnight run"))
    live3 = create_order(buyers[2], [{"listing_id": listings[8].id, "qty": 15}], delivery_mode=DeliveryMode.PICKUP,
                         address=None, note="I'll pick up on Saturday", idempotency_key=None)
    db.session.commit()
    _ = (live1, live3)
    return len(listings)


def register_cli(app):
    @app.cli.command("seed")
    @click.option("--reset", is_flag=True, help="Drop and recreate all tables first (destroys data).")
    def seed(reset):
        """Load sample prices plus demo users, listings and orders."""
        if reset:
            db.drop_all()
            db.create_all()
        n = generate_sample_prices()
        m = seed_demo()
        click.echo(f"Seeded {n} sample price records and {m} listings. Demo password: {DEMO_PASSWORD}")

    @app.cli.command("seed-if-empty")
    def seed_if_empty():
        """Seed only when the database has no users (safe to run on every deploy).

        The demo admin is skipped unless DEMO_ADMIN=1, because its password is public.
        """
        if db.session.scalar(db.select(db.func.count(User.id))):
            click.echo("Database already has data; skipping seed.")
            return
        n = generate_sample_prices()
        m = seed_demo(with_admin=os.getenv("DEMO_ADMIN") == "1")
        click.echo(f"Seeded {n} price records and {m} listings.")

    @app.cli.command("ensure-admin")
    def ensure_admin():
        """Create the admin from ADMIN_EMAIL / ADMIN_PASSWORD if it doesn't exist yet (safe on every deploy)."""
        email = os.getenv("ADMIN_EMAIL", "").strip().lower()
        password = os.getenv("ADMIN_PASSWORD", "")
        if not email or not password:
            click.echo("ADMIN_EMAIL / ADMIN_PASSWORD not set; skipping admin bootstrap.")
            return
        if len(password) < 12:
            raise click.ClickException("ADMIN_PASSWORD must be at least 12 characters")
        if db.session.scalar(db.select(User.id).where(User.email == email)):
            click.echo(f"Admin {email} already exists.")
            return
        from .auth import hash_password
        db.session.add(User(name="Admin", email=email, role=Role.ADMIN, verified=True,
                            password_hash=hash_password(password)))
        db.session.commit()
        click.echo(f"Admin {email} created.")

    @app.cli.command("import-prices")
    @click.option("--state", default="Tamil Nadu")
    @click.option("--limit", default=2000)
    def import_prices(state, limit):
        """Import today's mandi prices from data.gov.in (AGMARKNET). Needs DATA_GOV_API_KEY."""
        key = app.config["DATA_GOV_API_KEY"]
        if not key:
            raise click.ClickException("Set DATA_GOV_API_KEY (free key from https://data.gov.in)")
        resource = os.getenv("DATA_GOV_RESOURCE", "9ef84268-d588-465a-a308-a864a43d0070")
        qs = urllib.parse.urlencode({"api-key": key, "format": "json", "limit": limit, "filters[state]": state})
        with urllib.request.urlopen(f"https://api.data.gov.in/resource/{resource}?{qs}", timeout=30) as r:
            records = json.load(r).get("records", [])
        added = 0
        for rec in records:
            try:
                date = datetime.strptime(rec["arrival_date"], "%d/%m/%Y").replace(tzinfo=timezone.utc)
                commodity = rec["commodity"].split("(")[0].strip().title()
                market = rec["market"].strip()
                exists = db.session.scalar(db.select(PriceRecord.id).where(
                    PriceRecord.commodity == commodity, PriceRecord.market == market, PriceRecord.date == date))
                if exists:
                    continue
                db.session.add(PriceRecord(commodity=commodity, market=market, state=rec.get("state"), date=date,
                                           min_price=Decimal(str(rec["min_price"])), max_price=Decimal(str(rec["max_price"])),
                                           modal_price=Decimal(str(rec["modal_price"])), source="agmarknet"))
                added += 1
            except (KeyError, ValueError, ArithmeticError):
                continue
        db.session.commit()
        click.echo(f"Imported {added} AGMARKNET price records for {state}.")

    @app.cli.command("create-admin")
    @click.option("--email", prompt=True)
    @click.option("--name", default="Admin")
    @click.password_option()
    def create_admin(email, name, password):
        from .auth import hash_password
        db.session.add(User(name=name, email=email.lower(), role=Role.ADMIN, verified=True,
                            password_hash=hash_password(password)))
        db.session.commit()
        click.echo(f"Admin {email} created.")
