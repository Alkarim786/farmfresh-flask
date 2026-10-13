const inr = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 2 });
const inr0 = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 });

export const rupees = (v, whole = false) => (v === null || v === undefined ? "—" : (whole ? inr0 : inr).format(Number(v)));

export const qty = (v) => {
  const n = Number(v);
  return Number.isInteger(n) ? n.toLocaleString("en-IN") : n.toLocaleString("en-IN", { maximumFractionDigits: 2 });
};

export const when = (iso) => {
  if (!iso) return "";
  const d = new Date(iso);
  const diff = (Date.now() - d.getTime()) / 1000;
  if (diff < 60) return "just now";
  if (diff < 3600) return `${Math.floor(diff / 60)} min ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)} h ago`;
  if (diff < 86400 * 7) return `${Math.floor(diff / 86400)} d ago`;
  return d.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
};

export const dateTime = (iso) =>
  iso
    ? new Date(iso).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" })
    : "";

export const shortDate = (iso) =>
  iso ? new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short" }) : "";

export function diffVsMarket(price, market) {
  if (!market?.median) return null;
  const m = Number(market.median);
  if (!m) return null;
  return ((Number(price) - m) / m) * 100;
}

export const STATUS_LABEL = {
  PENDING: "Waiting for farmer",
  ACCEPTED: "Accepted",
  REJECTED: "Declined",
  TRANSPORT_ASSIGNED: "Truck booked",
  DISPATCHED: "On the way",
  DELIVERED: "Delivered",
  COMPLETED: "Completed",
  CANCELLED: "Cancelled",
};

export const EVENT_LABEL = {
  PENDING: "Order placed",
  ACCEPTED: "Accepted by farmer",
  REJECTED: "Declined by farmer",
  TRANSPORT_ASSIGNED: "Transporter booked",
  DISPATCHED: "Picked up",
  DELIVERED: "Delivered",
  COMPLETED: "Receipt confirmed",
  CANCELLED: "Cancelled",
};

export const PAYMENT_LABEL = {
  UNPAID: "Not paid",
  CREATED: "Payment started",
  PAID: "Paid",
  FAILED: "Payment failed",
  REFUND_PENDING: "Refund in progress",
  REFUNDED: "Refunded",
};
