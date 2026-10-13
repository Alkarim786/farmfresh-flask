import base64
import binascii
from datetime import datetime, timezone
from decimal import Decimal

from flask import Blueprint, Response, request
from sqlalchemy import or_
from sqlalchemy.orm import selectinload

from .common import (
    APIError, body, farmer_rating, forbidden, listing_json, not_found, ok, page_args, paginated,
    req_decimal, req_str, roles_required, user_public,
)
from .extensions import db
from .models import Listing, ListingImage, ListingStatus, Role, User
from .prices import market_reference

bp = Blueprint("listings", __name__, url_prefix="/api/v1")

UNITS = {"kg", "quintal", "dozen", "piece", "crate"}
GRADES = {"A", "B", "C"}
IMAGE_TYPES = {"image/jpeg", "image/png", "image/webp"}
MAX_IMAGES = 4
MAX_IMAGE_BYTES = 1_200_000


def _parse_date(v):
    if not v:
        return None
    try:
        return datetime.fromisoformat(str(v)[:10]).replace(tzinfo=timezone.utc)
    except ValueError:
        raise APIError("harvest_date must be YYYY-MM-DD", fields={"harvest_date": "invalid"})


def _apply(listing: Listing, data: dict, *, creating: bool):
    def has(k):
        return creating or k in data

    if has("crop"):
        listing.crop = req_str(data, "crop", max_len=60).title()
    if has("variety"):
        listing.variety = req_str(data, "variety", max_len=60, required=False)
    if has("grade"):
        grade = str(data.get("grade") or "A").upper()
        if grade not in GRADES:
            raise APIError("grade must be A, B or C", fields={"grade": "invalid"})
        listing.grade = grade
    if has("unit"):
        unit = str(data.get("unit") or "kg").lower()
        if unit not in UNITS:
            raise APIError(f"unit must be one of {', '.join(sorted(UNITS))}", fields={"unit": "invalid"})
        listing.unit = unit
    if has("price"):
        listing.price = req_decimal(data, "price", max_value=Decimal("10000000"))
    if has("min_order_qty"):
        listing.min_order_qty = req_decimal(data, "min_order_qty", required=False) or Decimal("1")
    if has("location"):
        listing.location = req_str(data, "location", max_len=120)
    if has("harvest_date"):
        listing.harvest_date = _parse_date(data.get("harvest_date"))
    if has("description"):
        listing.description = req_str(data, "description", max_len=2000, required=False)
    if has("organic"):
        listing.organic = bool(data.get("organic"))
    if creating:
        qty = req_decimal(data, "qty_total", max_value=Decimal("10000000"))
        listing.qty_total = qty
        listing.qty_available = qty
    elif "qty_available" in data:
        # Restock / adjust: changing what's on offer never touches stock already reserved by orders.
        new_avail = req_decimal(data, "qty_available", allow_zero=True, max_value=Decimal("10000000"))
        reserved = listing.qty_total - listing.qty_available
        listing.qty_available = new_avail
        listing.qty_total = reserved + new_avail
    if listing.min_order_qty and listing.qty_total and listing.min_order_qty > listing.qty_total:
        raise APIError("Minimum order can't exceed total quantity", fields={"min_order_qty": "max"})


def _save_images(listing: Listing, images):
    if not images:
        return
    if not isinstance(images, list):
        raise APIError("images must be a list")
    if len(listing.images) + len(images) > MAX_IMAGES:
        raise APIError(f"A listing can have at most {MAX_IMAGES} photos")
    for item in images:
        if not isinstance(item, str) or not item.startswith("data:") or "," not in item:
            raise APIError("Each image must be a data URL")
        header, b64 = item.split(",", 1)
        ctype = header[5:].split(";")[0]
        if ctype not in IMAGE_TYPES:
            raise APIError("Photos must be JPEG, PNG or WebP")
        try:
            raw = base64.b64decode(b64, validate=True)
        except (binascii.Error, ValueError):
            raise APIError("Photo data is corrupted")
        if len(raw) > MAX_IMAGE_BYTES:
            raise APIError("Each photo must be under 1.2 MB")
        listing.images.append(ListingImage(content_type=ctype, data=raw))


@bp.get("/listings")
def search_listings():
    page, size = page_args(default_size=24)
    q = (db.select(Listing).join(User, Listing.farmer_id == User.id)
         .where(Listing.status == ListingStatus.ACTIVE, Listing.qty_available > 0, User.active.is_(True))
         .options(selectinload(Listing.images), selectinload(Listing.farmer)))
    if term := request.args.get("q", "").strip():
        like = f"%{term[:60]}%"
        q = q.where(or_(Listing.crop.ilike(like), Listing.variety.ilike(like), Listing.location.ilike(like),
                        User.farm_name.ilike(like)))
    if crop := request.args.get("crop"):
        q = q.where(Listing.crop.ilike(crop))
    if loc := request.args.get("location"):
        q = q.where(Listing.location.ilike(f"%{loc[:60]}%"))
    if grade := request.args.get("grade"):
        q = q.where(Listing.grade == grade.upper())
    if request.args.get("organic") in ("1", "true"):
        q = q.where(Listing.organic.is_(True))
    try:
        if (mn := request.args.get("min_price")):
            q = q.where(Listing.price >= Decimal(mn))
        if (mx := request.args.get("max_price")):
            q = q.where(Listing.price <= Decimal(mx))
        if (mq := request.args.get("min_qty")):
            q = q.where(Listing.qty_available >= Decimal(mq))
    except ArithmeticError:
        raise APIError("Price and quantity filters must be numbers")
    sort = request.args.get("sort", "new")
    order = {"price_asc": Listing.price.asc(), "price_desc": Listing.price.desc(),
             "qty_desc": Listing.qty_available.desc()}.get(sort, Listing.created_at.desc())
    q = q.order_by(order, Listing.id.desc())
    return ok(paginated(q, page, size, lambda l: {**listing_json(l), "market": market_reference(l.crop, l.unit)}))


@bp.get("/listings/crops")
def crop_facets():
    rows = db.session.execute(
        db.select(Listing.crop, db.func.count(Listing.id))
        .where(Listing.status == ListingStatus.ACTIVE, Listing.qty_available > 0)
        .group_by(Listing.crop).order_by(db.func.count(Listing.id).desc())
    ).all()
    return ok([{"crop": c, "count": n} for c, n in rows])


@bp.get("/listings/<int:listing_id>")
def get_listing(listing_id):
    l = db.session.get(Listing, listing_id)
    if l is None or l.status == ListingStatus.HIDDEN:
        raise not_found("Listing")
    farmer = user_public(l.farmer) | {"rating": farmer_rating(l.farmer_id)}
    return ok({**listing_json(l), "farmer": farmer, "market": market_reference(l.crop, l.unit)})


@bp.get("/farmers/<int:farmer_id>")
def farmer_profile(farmer_id):
    f = db.session.get(User, farmer_id)
    if f is None or f.role != Role.FARMER or not f.active:
        raise not_found("Farmer")
    listings = db.session.scalars(db.select(Listing).where(
        Listing.farmer_id == f.id, Listing.status == ListingStatus.ACTIVE, Listing.qty_available > 0)).all()
    from .models import Review
    reviews = db.session.scalars(db.select(Review).where(Review.farmer_id == f.id)
                                 .order_by(Review.created_at.desc()).limit(10)).all()
    return ok({**user_public(f), "rating": farmer_rating(f.id),
               "listings": [listing_json(l, with_farmer=False) for l in listings],
               "reviews": [{"rating": r.rating, "comment": r.comment, "by": r.reviewer.name,
                            "at": r.created_at.isoformat()} for r in reviews]})


@bp.get("/my/listings")
@roles_required(Role.FARMER)
def my_listings(user):
    rows = db.session.scalars(db.select(Listing).where(Listing.farmer_id == user.id)
                              .options(selectinload(Listing.images))
                              .order_by(Listing.created_at.desc())).all()
    return ok([{**listing_json(l, with_farmer=False), "market": market_reference(l.crop, l.unit)} for l in rows])


@bp.post("/listings")
@roles_required(Role.FARMER)
def create_listing(user):
    data = body()
    l = Listing(farmer_id=user.id)
    _apply(l, data, creating=True)
    _save_images(l, data.get("images"))
    db.session.add(l)
    db.session.commit()
    return ok(listing_json(l), 201)


def _owned(user, listing_id) -> Listing:
    l = db.session.get(Listing, listing_id)
    if l is None:
        raise not_found("Listing")
    if l.farmer_id != user.id:
        raise forbidden("You can only change your own listings")
    return l


@bp.patch("/listings/<int:listing_id>")
@roles_required(Role.FARMER)
def update_listing(user, listing_id):
    l = _owned(user, listing_id)
    if l.status == ListingStatus.HIDDEN:
        raise forbidden("This listing was hidden by a moderator")
    data = body()
    _apply(l, data, creating=False)
    _save_images(l, data.get("images"))
    if "remove_images" in data:
        drop = {int(i) for i in data.get("remove_images") or []}
        l.images = [img for img in l.images if img.id not in drop]
    if "status" in data:
        new = str(data["status"]).upper()
        if new not in ("ACTIVE", "CLOSED"):
            raise APIError("status can be ACTIVE or CLOSED")
        l.status = ListingStatus(new)
    if l.status == ListingStatus.ACTIVE and l.qty_available == 0:
        l.status = ListingStatus.SOLD_OUT
    elif l.status == ListingStatus.SOLD_OUT and l.qty_available > 0:
        l.status = ListingStatus.ACTIVE
    db.session.commit()
    return ok(listing_json(l))


@bp.get("/images/<int:image_id>")
def image(image_id):
    img = db.session.get(ListingImage, image_id)
    if img is None:
        raise not_found("Image")
    return Response(img.data, mimetype=img.content_type,
                    headers={"Cache-Control": "public, max-age=604800, immutable"})
