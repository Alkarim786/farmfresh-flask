"""Market price reference.

Mandi prices (AGMARKNET / data.gov.in) are published in INR per quintal (100 kg).
The app stores them as published and converts to the listing's unit for comparison.
"""
from __future__ import annotations

import statistics
from datetime import timedelta
from decimal import Decimal

from flask import Blueprint, g, request

from .common import APIError, money, ok
from .extensions import db
from .models import Listing, ListingStatus, PriceRecord

bp = Blueprint("prices", __name__, url_prefix="/api/v1/prices")

PER_UNIT = {"kg": Decimal("100"), "quintal": Decimal("1")}  # divisor from INR/quintal


def _latest_date(commodity: str):
    return db.session.scalar(db.select(db.func.max(PriceRecord.date)).where(PriceRecord.commodity.ilike(commodity)))


def market_reference(crop: str, unit: str) -> dict | None:
    """Median modal price across markets over the latest 7 days of data, in the listing's unit."""
    cache = g.setdefault("_price_cache", {})
    key = (crop.lower(), unit)
    if key in cache:
        return cache[key]
    result = None
    if unit in PER_UNIT:
        latest = _latest_date(crop)
        if latest is not None:
            rows = db.session.execute(
                db.select(PriceRecord.modal_price, PriceRecord.source)
                .where(PriceRecord.commodity.ilike(crop), PriceRecord.date > latest - timedelta(days=7))
            ).all()
            if rows:
                med = Decimal(str(statistics.median([r[0] for r in rows])))
                result = {"median": money(med / PER_UNIT[unit]), "unit": unit, "as_of": latest.date().isoformat(),
                          "markets": len(rows), "source": rows[0][1]}
    cache[key] = result
    return result


@bp.get("/commodities")
def commodities():
    rows = db.session.execute(
        db.select(PriceRecord.commodity, db.func.max(PriceRecord.date), db.func.count(db.distinct(PriceRecord.market)))
        .group_by(PriceRecord.commodity).order_by(PriceRecord.commodity)
    ).all()
    return ok([{"commodity": c, "latest": d.date().isoformat(), "markets": m} for c, d, m in rows])


@bp.get("")
def commodity_prices():
    commodity = request.args.get("commodity", "").strip()
    if not commodity:
        raise APIError("commodity is required")
    try:
        days = min(365, max(7, int(request.args.get("days", 60))))
    except ValueError:
        raise APIError("days must be an integer")
    latest = _latest_date(commodity)
    if latest is None:
        return ok({"commodity": commodity, "series": [], "markets": [], "source": None})
    since = latest - timedelta(days=days)
    rows = db.session.scalars(db.select(PriceRecord).where(
        PriceRecord.commodity.ilike(commodity), PriceRecord.date > since).order_by(PriceRecord.date)).all()

    by_date: dict = {}
    for r in rows:
        by_date.setdefault(r.date.date(), []).append(r)
    series = [{"date": d.isoformat(),
               "median": money(Decimal(str(statistics.median([x.modal_price for x in rs]))) / 100),
               "min": money(min(x.min_price for x in rs) / 100),
               "max": money(max(x.max_price for x in rs) / 100)} for d, rs in sorted(by_date.items())]

    latest_by_market: dict = {}
    for r in rows:
        latest_by_market[r.market] = r
    markets = sorted(({"market": r.market, "state": r.state, "date": r.date.date().isoformat(),
                       "modal_per_kg": money(r.modal_price / 100), "min_per_kg": money(r.min_price / 100),
                       "max_per_kg": money(r.max_price / 100)} for r in latest_by_market.values()),
                     key=lambda m: Decimal(m["modal_per_kg"]), reverse=True)
    return ok({"commodity": rows[0].commodity, "unit": "kg", "series": series, "markets": markets,
               "source": rows[-1].source})


@bp.get("/board")
def board():
    """Rate board: for each crop on sale, the average farm-gate asking price vs. the mandi median (per kg)."""
    rows = db.session.execute(
        db.select(Listing.crop, db.func.avg(Listing.price), db.func.sum(Listing.qty_available), db.func.count(Listing.id))
        .where(Listing.status == ListingStatus.ACTIVE, Listing.unit == "kg", Listing.qty_available > 0)
        .group_by(Listing.crop).order_by(db.func.sum(Listing.qty_available).desc()).limit(12)
    ).all()
    out = []
    for crop, avg, qty, n in rows:
        ref = market_reference(crop, "kg")
        avg = Decimal(avg).quantize(Decimal("0.01"))
        diff = None
        if ref:
            med = Decimal(ref["median"])
            diff = float(((avg - med) / med * 100).quantize(Decimal("0.1"))) if med else None
        out.append({"crop": crop, "farm_price": money(avg), "market_median": ref["median"] if ref else None,
                    "diff_percent": diff, "qty_available": money(qty), "listings": n,
                    "source": ref["source"] if ref else None})
    return ok(out)
