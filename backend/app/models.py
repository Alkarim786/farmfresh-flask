"""Database models.

Money is always stored as NUMERIC(12, 2) (Python Decimal), never float.
Timestamps are timezone-aware UTC; the UI renders them in the viewer's local zone.
"""
from __future__ import annotations

import enum
from datetime import datetime, timezone
from decimal import Decimal

from sqlalchemy import (
    CheckConstraint, ForeignKey, Index, LargeBinary, Numeric, String, Text, UniqueConstraint,
    Enum as SAEnum,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .extensions import db


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


Money = Numeric(12, 2)
Qty = Numeric(12, 2)


class Role(str, enum.Enum):
    FARMER = "FARMER"
    BUYER = "BUYER"
    TRANSPORTER = "TRANSPORTER"
    ADMIN = "ADMIN"


class ListingStatus(str, enum.Enum):
    ACTIVE = "ACTIVE"
    SOLD_OUT = "SOLD_OUT"
    CLOSED = "CLOSED"
    HIDDEN = "HIDDEN"  # hidden by an admin (moderation)


class OrderStatus(str, enum.Enum):
    PENDING = "PENDING"
    ACCEPTED = "ACCEPTED"
    REJECTED = "REJECTED"
    TRANSPORT_ASSIGNED = "TRANSPORT_ASSIGNED"
    DISPATCHED = "DISPATCHED"
    DELIVERED = "DELIVERED"
    COMPLETED = "COMPLETED"
    CANCELLED = "CANCELLED"


class DeliveryMode(str, enum.Enum):
    DELIVERY = "DELIVERY"
    PICKUP = "PICKUP"


class PaymentStatus(str, enum.Enum):
    UNPAID = "UNPAID"
    CREATED = "CREATED"
    PAID = "PAID"
    FAILED = "FAILED"
    REFUND_PENDING = "REFUND_PENDING"
    REFUNDED = "REFUNDED"


class QuoteStatus(str, enum.Enum):
    OPEN = "OPEN"
    ACCEPTED = "ACCEPTED"
    DECLINED = "DECLINED"
    WITHDRAWN = "WITHDRAWN"


def _enum(e):
    return SAEnum(e, name=e.__name__.lower(), native_enum=False, length=24)


class User(db.Model):
    __tablename__ = "users"
    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(120))
    email: Mapped[str] = mapped_column(String(255), unique=True, index=True)
    phone: Mapped[str | None] = mapped_column(String(20))
    password_hash: Mapped[str] = mapped_column(String(128))
    role: Mapped[Role] = mapped_column(_enum(Role), index=True)
    verified: Mapped[bool] = mapped_column(default=False)
    active: Mapped[bool] = mapped_column(default=True)
    # profile
    location: Mapped[str | None] = mapped_column(String(120))
    farm_name: Mapped[str | None] = mapped_column(String(120))
    business_type: Mapped[str | None] = mapped_column(String(60))
    vehicle_type: Mapped[str | None] = mapped_column(String(60))
    vehicle_capacity_kg: Mapped[int | None]
    service_area: Mapped[str | None] = mapped_column(String(200))
    created_at: Mapped[datetime] = mapped_column(default=utcnow)


class Listing(db.Model):
    __tablename__ = "listings"
    __table_args__ = (
        CheckConstraint("qty_available >= 0", name="ck_listing_qty_nonneg"),
        CheckConstraint("price > 0", name="ck_listing_price_pos"),
        Index("ix_listing_search", "status", "crop"),
    )
    id: Mapped[int] = mapped_column(primary_key=True)
    farmer_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    crop: Mapped[str] = mapped_column(String(60), index=True)
    variety: Mapped[str | None] = mapped_column(String(60))
    grade: Mapped[str] = mapped_column(String(10), default="A")
    unit: Mapped[str] = mapped_column(String(10), default="kg")
    qty_total: Mapped[Decimal] = mapped_column(Qty)
    qty_available: Mapped[Decimal] = mapped_column(Qty)
    min_order_qty: Mapped[Decimal] = mapped_column(Qty, default=Decimal("1"))
    price: Mapped[Decimal] = mapped_column(Money)
    location: Mapped[str] = mapped_column(String(120), index=True)
    harvest_date: Mapped[datetime | None]
    description: Mapped[str | None] = mapped_column(Text)
    organic: Mapped[bool] = mapped_column(default=False)
    status: Mapped[ListingStatus] = mapped_column(_enum(ListingStatus), default=ListingStatus.ACTIVE)
    created_at: Mapped[datetime] = mapped_column(default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(default=utcnow, onupdate=utcnow)

    farmer: Mapped[User] = relationship()
    images: Mapped[list["ListingImage"]] = relationship(
        back_populates="listing", cascade="all, delete-orphan", order_by="ListingImage.id"
    )


class ListingImage(db.Model):
    """Images are resized in the browser and stored in Postgres, so a single managed
    database is the only stateful dependency (no object-storage account needed)."""
    __tablename__ = "listing_images"
    id: Mapped[int] = mapped_column(primary_key=True)
    listing_id: Mapped[int] = mapped_column(ForeignKey("listings.id", ondelete="CASCADE"), index=True)
    content_type: Mapped[str] = mapped_column(String(40))
    data: Mapped[bytes] = mapped_column(LargeBinary, deferred=True)
    listing: Mapped[Listing] = relationship(back_populates="images")


class Order(db.Model):
    __tablename__ = "orders"
    __table_args__ = (
        UniqueConstraint("buyer_id", "idempotency_key", name="uq_order_idempotency"),
    )
    id: Mapped[int] = mapped_column(primary_key=True)
    buyer_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    farmer_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    transporter_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"), index=True)
    status: Mapped[OrderStatus] = mapped_column(_enum(OrderStatus), default=OrderStatus.PENDING, index=True)
    delivery_mode: Mapped[DeliveryMode] = mapped_column(_enum(DeliveryMode), default=DeliveryMode.DELIVERY)
    delivery_address: Mapped[str | None] = mapped_column(String(300))
    note: Mapped[str | None] = mapped_column(String(500))
    subtotal: Mapped[Decimal] = mapped_column(Money)
    transport_fee: Mapped[Decimal] = mapped_column(Money, default=Decimal("0"))
    payment_status: Mapped[PaymentStatus] = mapped_column(_enum(PaymentStatus), default=PaymentStatus.UNPAID)
    idempotency_key: Mapped[str | None] = mapped_column(String(64))
    created_at: Mapped[datetime] = mapped_column(default=utcnow, index=True)
    updated_at: Mapped[datetime] = mapped_column(default=utcnow, onupdate=utcnow)

    buyer: Mapped[User] = relationship(foreign_keys=[buyer_id])
    farmer: Mapped[User] = relationship(foreign_keys=[farmer_id])
    transporter: Mapped[User | None] = relationship(foreign_keys=[transporter_id])
    items: Mapped[list["OrderItem"]] = relationship(back_populates="order", cascade="all, delete-orphan")
    events: Mapped[list["OrderEvent"]] = relationship(order_by="OrderEvent.id", cascade="all, delete-orphan")

    @property
    def total(self) -> Decimal:
        return (self.subtotal or Decimal("0")) + (self.transport_fee or Decimal("0"))

    @property
    def total_qty(self) -> Decimal:
        return sum((i.qty for i in self.items), Decimal("0"))


class OrderItem(db.Model):
    __tablename__ = "order_items"
    __table_args__ = (CheckConstraint("qty > 0", name="ck_item_qty_pos"),)
    id: Mapped[int] = mapped_column(primary_key=True)
    order_id: Mapped[int] = mapped_column(ForeignKey("orders.id", ondelete="CASCADE"), index=True)
    listing_id: Mapped[int] = mapped_column(ForeignKey("listings.id"), index=True)
    qty: Mapped[Decimal] = mapped_column(Qty)
    # Price is copied at order time: later listing edits never rewrite history.
    agreed_unit_price: Mapped[Decimal] = mapped_column(Money)
    crop_snapshot: Mapped[str] = mapped_column(String(120))
    unit_snapshot: Mapped[str] = mapped_column(String(10))

    order: Mapped[Order] = relationship(back_populates="items")
    listing: Mapped[Listing] = relationship()

    @property
    def line_total(self) -> Decimal:
        return (self.qty * self.agreed_unit_price).quantize(Decimal("0.01"))


class OrderEvent(db.Model):
    """Append-only audit log of every order status / payment change."""
    __tablename__ = "order_events"
    id: Mapped[int] = mapped_column(primary_key=True)
    order_id: Mapped[int] = mapped_column(ForeignKey("orders.id", ondelete="CASCADE"), index=True)
    from_status: Mapped[str | None] = mapped_column(String(24))
    to_status: Mapped[str] = mapped_column(String(24))
    actor_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"))
    note: Mapped[str | None] = mapped_column(String(300))
    at: Mapped[datetime] = mapped_column(default=utcnow)
    actor: Mapped[User | None] = relationship()


class TransportQuote(db.Model):
    __tablename__ = "transport_quotes"
    __table_args__ = (
        UniqueConstraint("order_id", "transporter_id", name="uq_one_quote_per_transporter"),
        CheckConstraint("fee >= 0", name="ck_quote_fee_nonneg"),
    )
    id: Mapped[int] = mapped_column(primary_key=True)
    order_id: Mapped[int] = mapped_column(ForeignKey("orders.id", ondelete="CASCADE"), index=True)
    transporter_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    fee: Mapped[Decimal] = mapped_column(Money)
    vehicle_type: Mapped[str] = mapped_column(String(60))
    eta_hours: Mapped[int]
    note: Mapped[str | None] = mapped_column(String(300))
    status: Mapped[QuoteStatus] = mapped_column(_enum(QuoteStatus), default=QuoteStatus.OPEN)
    created_at: Mapped[datetime] = mapped_column(default=utcnow)
    transporter: Mapped[User] = relationship()
    order: Mapped[Order] = relationship()


class Payment(db.Model):
    __tablename__ = "payments"
    id: Mapped[int] = mapped_column(primary_key=True)
    order_id: Mapped[int] = mapped_column(ForeignKey("orders.id", ondelete="CASCADE"), index=True)
    provider: Mapped[str] = mapped_column(String(20))  # razorpay | demo
    provider_order_id: Mapped[str] = mapped_column(String(64), unique=True)
    provider_payment_id: Mapped[str | None] = mapped_column(String(64), unique=True)
    provider_refund_id: Mapped[str | None] = mapped_column(String(64))
    amount: Mapped[Decimal] = mapped_column(Money)
    currency: Mapped[str] = mapped_column(String(3), default="INR")
    status: Mapped[PaymentStatus] = mapped_column(_enum(PaymentStatus), default=PaymentStatus.CREATED)
    created_at: Mapped[datetime] = mapped_column(default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(default=utcnow, onupdate=utcnow)


class PriceRecord(db.Model):
    __tablename__ = "price_records"
    __table_args__ = (
        UniqueConstraint("commodity", "market", "date", name="uq_price_point"),
        Index("ix_price_commodity_date", "commodity", "date"),
    )
    id: Mapped[int] = mapped_column(primary_key=True)
    commodity: Mapped[str] = mapped_column(String(60))
    market: Mapped[str] = mapped_column(String(80))
    state: Mapped[str | None] = mapped_column(String(60))
    date: Mapped[datetime]
    min_price: Mapped[Decimal] = mapped_column(Money)   # INR per quintal, as published by mandis
    max_price: Mapped[Decimal] = mapped_column(Money)
    modal_price: Mapped[Decimal] = mapped_column(Money)
    source: Mapped[str] = mapped_column(String(40), default="sample")


class Review(db.Model):
    __tablename__ = "reviews"
    __table_args__ = (
        UniqueConstraint("order_id", name="uq_one_review_per_order"),
        CheckConstraint("rating BETWEEN 1 AND 5", name="ck_rating_range"),
    )
    id: Mapped[int] = mapped_column(primary_key=True)
    order_id: Mapped[int] = mapped_column(ForeignKey("orders.id", ondelete="CASCADE"))
    reviewer_id: Mapped[int] = mapped_column(ForeignKey("users.id"))
    farmer_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    rating: Mapped[int]
    comment: Mapped[str | None] = mapped_column(String(500))
    created_at: Mapped[datetime] = mapped_column(default=utcnow)
    reviewer: Mapped[User] = relationship(foreign_keys=[reviewer_id])


class Notification(db.Model):
    __tablename__ = "notifications"
    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    title: Mapped[str] = mapped_column(String(160))
    body: Mapped[str | None] = mapped_column(String(400))
    link: Mapped[str | None] = mapped_column(String(200))
    read: Mapped[bool] = mapped_column(default=False)
    created_at: Mapped[datetime] = mapped_column(default=utcnow, index=True)
