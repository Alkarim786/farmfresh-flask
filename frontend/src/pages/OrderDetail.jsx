import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { toast } from "sonner";
import { Check, CreditCard, MapPin, Phone, ShieldCheck, Truck } from "lucide-react";
import { api } from "../lib/api";
import { useApi } from "../lib/useApi";
import { useSession } from "../lib/session";
import { confirmDemoPayment, startPayment } from "../lib/pay";
import { dateTime, EVENT_LABEL, qty, rupees, STATUS_LABEL } from "../lib/format";
import {
  Button, Card, ErrorNote, Input, Modal, PaymentPill, Spinner, StarInput, StatusPill, Stars, Textarea, Verified, cx,
} from "../components/ui";

function steps(o) {
  const delivery = o.delivery_mode === "DELIVERY";
  const s = [
    ["Placed", true],
    ["Accepted", !["PENDING"].includes(o.status)],
    ...(delivery ? [["Truck booked", ["TRANSPORT_ASSIGNED", "DISPATCHED", "DELIVERED", "COMPLETED"].includes(o.status)]] : []),
    ["Paid", ["PAID", "REFUNDED", "REFUND_PENDING"].includes(o.payment_status)],
    ...(delivery ? [["On the way", ["DISPATCHED", "DELIVERED", "COMPLETED"].includes(o.status)]] : []),
    [delivery ? "Delivered" : "Handed over", ["DELIVERED", "COMPLETED"].includes(o.status)],
    ["Completed", o.status === "COMPLETED"],
  ];
  return s;
}

function Progress({ order }) {
  if (["REJECTED", "CANCELLED"].includes(order.status)) {
    return (
      <div className="rounded-2xl bg-[#eef1f5] p-5">
        <p className="font-semibold">{order.status === "REJECTED" ? "The farmer declined this order." : "This order was cancelled."}</p>
        <p className="text-sm text-muted mt-1">
          Reserved stock went back on sale.
          {order.payment_status === "REFUNDED" && " Your payment has been refunded."}
          {order.payment_status === "REFUND_PENDING" && " Your refund is being processed by the bank."}
        </p>
      </div>
    );
  }
  const s = steps(order);
  const current = s.findIndex(([, done]) => !done);
  return (
    <ol className="flex items-start" aria-label="Order progress">
      {s.map(([label, done], i) => (
        <li key={label} className="flex-1 flex flex-col items-center text-center relative min-w-0">
          {i > 0 && <span className={cx("absolute top-3.5 right-1/2 w-full h-0.5", done ? "bg-tarp" : "bg-line")} aria-hidden />}
          <span className={cx("relative z-10 size-7 rounded-full grid place-items-center border-2 text-xs font-bold",
            done ? "bg-tarp border-tarp text-white" : i === current ? "bg-white border-tarp text-tarp" : "bg-white border-line text-faint")}>
            {done ? <Check className="size-4" strokeWidth={3} /> : i + 1}
          </span>
          <span className={cx("text-[0.72rem] sm:text-sm mt-2 leading-tight px-0.5", done ? "text-ink font-semibold" : i === current ? "text-tarp font-semibold" : "text-faint")}>
            {label}
            <span className="sr-only">{done ? " (done)" : i === current ? " (next)" : ""}</span>
          </span>
        </li>
      ))}
    </ol>
  );
}

function Party({ label, u }) {
  if (!u) return null;
  return (
    <div>
      <p className="text-sm text-muted">{label}</p>
      <p className="font-semibold flex items-center gap-1">{u.farm_name || u.name}{u.verified && <Verified />}</p>
      {u.farm_name && <p className="text-sm text-muted">{u.name}</p>}
      {u.phone && (
        <a href={`tel:${u.phone.replace(/\s/g, "")}`} className="text-sm text-tarp font-semibold inline-flex items-center gap-1 mt-0.5">
          <Phone className="size-3.5" aria-hidden />{u.phone}
        </a>
      )}
    </div>
  );
}

function QuoteForm({ order, existing, onDone }) {
  const { user } = useSession();
  const [f, setF] = useState({ fee: existing?.fee || "", eta_hours: existing?.eta_hours || "", vehicle_type: existing?.vehicle_type || user.vehicle_type || "", note: existing?.note || "" });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      await api(`/transport/jobs/${order.id}/quotes`, { method: "POST", body: f });
      toast.success(existing ? "Quote updated" : "Quote sent to the buyer");
      onDone();
    } catch (e2) {
      setErr(e2.message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <form onSubmit={submit} className="space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <Input label="Your price (₹)" type="number" inputMode="decimal" required value={f.fee} onChange={(e) => setF({ ...f, fee: e.target.value })} />
        <Input label="Delivery in (hours)" type="number" inputMode="numeric" required value={f.eta_hours} onChange={(e) => setF({ ...f, eta_hours: e.target.value })} />
      </div>
      <Input label="Vehicle" value={f.vehicle_type} onChange={(e) => setF({ ...f, vehicle_type: e.target.value })} />
      <Input label="Note for the buyer (optional)" value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} placeholder="Cold chain, can leave tonight…" />
      {err && <p className="text-sm text-chilli">{err}</p>}
      <Button type="submit" className="w-full" loading={busy}>{existing ? "Update quote" : "Send quote"}</Button>
    </form>
  );
}

export default function OrderDetail() {
  const { id } = useParams();
  const { user } = useSession();
  const { data: o, error, loading, reload, setData } = useApi(`/orders/${id}`, { interval: 15000 });
  const [busy, setBusy] = useState(null);
  const [demo, setDemo] = useState(null);
  const [reason, setReason] = useState({ open: false, to: null, text: "" });
  const [review, setReview] = useState({ rating: 0, comment: "" });

  if (loading) return <Spinner label="Loading order" />;
  if (error) return <div className="max-w-3xl mx-auto p-6"><ErrorNote error={error} /></div>;

  const isBuyer = user.id === o.buyer.id, isFarmer = user.id === o.farmer.id;
  const isTransporter = o.transporter && user.id === o.transporter.id;
  const delivery = o.delivery_mode === "DELIVERY";
  const paid = o.payment_status === "PAID";
  const payable = isBuyer && !paid && ((o.status === "ACCEPTED" && !delivery) || o.status === "TRANSPORT_ASSIGNED");

  const move = async (to, note) => {
    setBusy(to);
    try {
      const next = await api(`/orders/${o.id}/status`, { method: "PATCH", body: { status: to, note } });
      setData((d) => ({ ...d, ...next }));
      toast.success(`Order ${STATUS_LABEL[to].toLowerCase()}`);
      reload();
    } catch (e) {
      toast.error(e.message);
    } finally {
      setBusy(null);
      setReason({ open: false, to: null, text: "" });
    }
  };

  const pay = async () => {
    setBusy("pay");
    try {
      const r = await startPayment(o.id);
      if (r.demo) setDemo(r.demo);
      else if (r.paid) {
        toast.success("Payment received. The transporter can now pick up.");
        reload();
      }
    } catch (e) {
      toast.error(e.message);
      reload();
    } finally {
      setBusy(null);
    }
  };

  const chooseQuote = async (q) => {
    setBusy(`q${q.id}`);
    try {
      await api(`/transport/quotes/${q.id}/accept`, { method: "POST", body: { fee: q.fee } });
      toast.success(`${q.transporter.name} is booked. Pay to confirm pickup.`);
      reload();
    } catch (e) {
      toast.error(e.message);
      if (e.code === "quote_changed") reload();
    } finally {
      setBusy(null);
    }
  };

  const submitReview = async () => {
    setBusy("review");
    try {
      await api(`/orders/${o.id}/review`, { method: "POST", body: review });
      toast.success("Thanks, your rating is on the farmer's profile");
      reload();
    } catch (e) {
      toast.error(e.message);
    } finally {
      setBusy(null);
    }
  };

  // What should this viewer do next? One primary action, shown prominently.
  let next = null;
  if (isFarmer && o.status === "PENDING") {
    next = (
      <ActionBox title="Can you fulfil this order?" body="Accepting confirms the quantity and price. The stock is already set aside for this buyer.">
        <Button variant="success" loading={busy === "ACCEPTED"} onClick={() => move("ACCEPTED")}>Accept order</Button>
        <Button variant="danger" onClick={() => setReason({ open: true, to: "REJECTED", text: "" })}>Decline</Button>
      </ActionBox>
    );
  } else if (isBuyer && o.status === "PENDING") {
    next = <ActionBox title="Waiting for the farmer" body="You'll get a notification as soon as they respond. Nothing has been charged." />;
  } else if (isBuyer && o.status === "ACCEPTED" && delivery) {
    next = (
      <ActionBox title="Choose a transporter" body={o.quotes?.filter((q) => q.status === "OPEN").length ? "Quotes from transporters near the farm. The fee is added to your payment." : "Transporters have been notified. Quotes usually arrive within a few hours."}>
        {null}
      </ActionBox>
    );
  } else if (payable) {
    next = (
      <ActionBox title={`Pay ${rupees(o.total)} to confirm`} body={delivery ? "Your payment is held for this order and the transporter picks up once it's confirmed." : "Pay now, then collect from the farm."}>
        <Button size="lg" loading={busy === "pay"} onClick={pay}><CreditCard className="size-4" aria-hidden />Pay {rupees(o.total)}</Button>
      </ActionBox>
    );
  } else if (isTransporter && o.status === "TRANSPORT_ASSIGNED") {
    next = paid ? (
      <ActionBox title="Ready for pickup" body={`Collect from ${o.pickup_location}. Mark it once the load is on your vehicle.`}>
        <Button loading={busy === "DISPATCHED"} onClick={() => move("DISPATCHED")}><Truck className="size-4" aria-hidden />Picked up, on the way</Button>
      </ActionBox>
    ) : (
      <ActionBox title="Waiting for the buyer to pay" body="Don't collect the load until the payment shows as paid." />
    );
  } else if (isTransporter && o.status === "DISPATCHED") {
    next = (
      <ActionBox title="Delivering" body={`Drop at: ${o.delivery_address}`}>
        <Button variant="success" loading={busy === "DELIVERED"} onClick={() => move("DELIVERED")}>Mark delivered</Button>
      </ActionBox>
    );
  } else if (isFarmer && o.status === "ACCEPTED" && !delivery) {
    next = paid ? (
      <ActionBox title="Buyer has paid" body="Hand over the produce when they arrive, then mark it here.">
        <Button variant="success" loading={busy === "DELIVERED"} onClick={() => move("DELIVERED")}>Handed over</Button>
      </ActionBox>
    ) : (
      <ActionBox title="Waiting for payment" body="The buyer pays before collecting." />
    );
  } else if (isBuyer && o.status === "DELIVERED") {
    next = (
      <ActionBox title="Got everything?" body="Confirming closes the order. If something's wrong, contact the farmer first.">
        <Button variant="success" loading={busy === "COMPLETED"} onClick={() => move("COMPLETED")}>Yes, I received it</Button>
      </ActionBox>
    );
  } else if (isBuyer && o.status === "COMPLETED" && !o.review) {
    next = (
      <ActionBox title={`Rate ${o.farmer.farm_name || o.farmer.name}`} body="Your rating helps other buyers.">
        <div className="w-full space-y-3">
          <StarInput value={review.rating} onChange={(rating) => setReview({ ...review, rating })} />
          <Textarea rows={2} placeholder="What was the produce like? (optional)" value={review.comment} onChange={(e) => setReview({ ...review, comment: e.target.value })} />
          <Button disabled={!review.rating} loading={busy === "review"} onClick={submitReview}>Post rating</Button>
        </div>
      </ActionBox>
    );
  }

  const canCancel = (isBuyer && ["PENDING", "ACCEPTED", "TRANSPORT_ASSIGNED"].includes(o.status)) || (isFarmer && o.status === "ACCEPTED");
  const openQuotes = (o.quotes || []).filter((q) => q.status === "OPEN" || q.status === "ACCEPTED");

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 py-8 sm:py-10">
      <Link to={user.role === "TRANSPORTER" ? (isTransporter ? "/deliveries" : "/jobs") : "/orders"} className="text-sm text-muted hover:text-ink">← Back</Link>
      <div className="flex flex-wrap items-center gap-3 mt-2 mb-6">
        <h1 className="text-3xl sm:text-[2.4rem] font-extrabold">Order #{o.id}</h1>
        <StatusPill status={o.status} className="text-sm" viewer={isFarmer ? "FARMER" : undefined} />
        <PaymentPill status={o.payment_status} />
      </div>

      <Card className="p-5 sm:p-6 mb-6"><Progress order={o} /></Card>

      <div className="grid lg:grid-cols-[1fr_360px] gap-6 items-start">
        <div className="space-y-6">
          {next}

          {isBuyer && o.status === "ACCEPTED" && delivery && (
            <Card className="overflow-hidden">
              <div className="px-5 py-3 border-b border-line flex justify-between"><h2 className="font-bold text-lg">Delivery quotes</h2><span className="text-sm text-muted">Cheapest first</span></div>
              {openQuotes.length ? (
                <ul>
                  {openQuotes.map((q, i) => (
                    <li key={q.id} className="p-5 border-b border-line last:border-0 flex flex-wrap gap-4 items-center">
                      <div className="flex-1 min-w-48">
                        <p className="font-semibold flex items-center gap-1">{q.transporter.name}{q.transporter.verified && <Verified />}
                          {i === 0 && openQuotes.length > 1 && <span className="ml-2 text-xs font-semibold text-leaf bg-leaf-soft rounded px-1.5 py-0.5">Lowest</span>}</p>
                        <p className="text-sm text-muted">{q.vehicle_type}, about {q.eta_hours} h</p>
                        {q.note && <p className="text-sm mt-1">“{q.note}”</p>}
                      </div>
                      <p className="font-display text-2xl font-bold num">{rupees(q.fee)}</p>
                      <Button loading={busy === `q${q.id}`} onClick={() => chooseQuote(q)}>Book</Button>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="p-5 text-muted">No quotes yet. This page updates on its own.</p>
              )}
            </Card>
          )}

          {user.role === "TRANSPORTER" && !isTransporter && o.status === "ACCEPTED" && (
            <Card className="p-5">
              <h2 className="font-bold text-lg mb-1">{o.my_quote ? "Your quote" : "Quote for this load"}</h2>
              <p className="text-sm text-muted mb-4">{qty(o.total_qty)} {o.items[0].unit} from {o.pickup_location}. The buyer sees every quote and picks one.</p>
              <QuoteForm order={o} existing={o.my_quote?.status === "OPEN" ? o.my_quote : null} onDone={reload} />
            </Card>
          )}

          <Card className="overflow-hidden">
            <h2 className="font-bold text-lg px-5 py-3 border-b border-line">Items</h2>
            <ul>
              {o.items.map((i) => (
                <li key={i.id} className="px-5 py-3 border-b border-line flex justify-between gap-4 num">
                  <span><Link to={`/listing/${i.listing_id}`} className="font-semibold hover:text-tarp">{i.crop}</Link>
                    <span className="block text-sm text-muted">{qty(i.qty)} {i.unit} × {rupees(i.unit_price)}</span></span>
                  <span className="font-semibold">{rupees(i.line_total)}</span>
                </li>
              ))}
            </ul>
            <div className="px-5 py-3 space-y-1 num bg-[#fbfcfd]">
              <div className="flex justify-between text-muted"><span>Produce</span><span>{rupees(o.subtotal)}</span></div>
              {delivery && <div className="flex justify-between text-muted"><span>Delivery</span><span>{Number(o.transport_fee) ? rupees(o.transport_fee) : "Not booked yet"}</span></div>}
              <div className="flex justify-between font-display text-xl font-bold pt-1"><span>Total</span><span>{rupees(o.total)}</span></div>
            </div>
          </Card>

          {o.note && <Card className="p-5"><p className="text-sm text-muted">Buyer's note</p><p className="mt-1">{o.note}</p></Card>}
        </div>

        <div className="space-y-6">
          <Card className="p-5 space-y-4">
            <Party label="Farmer" u={o.farmer} />
            <Party label="Buyer" u={o.buyer} />
            {o.transporter && <Party label="Transporter" u={o.transporter} />}
            <div className="border-t border-line pt-4 space-y-2 text-sm">
              <p className="flex gap-2"><MapPin className="size-4 text-muted shrink-0 mt-0.5" aria-hidden /><span><span className="text-muted">Pickup: </span>{o.pickup_location}</span></p>
              {delivery && <p className="flex gap-2"><Truck className="size-4 text-muted shrink-0 mt-0.5" aria-hidden /><span><span className="text-muted">Deliver to: </span>{o.delivery_address || "Shared after the farmer accepts"}</span></p>}
            </div>
            {o.review && <div className="border-t border-line pt-4"><p className="text-sm text-muted">Buyer's rating</p><Stars value={o.review.rating} />{o.review.comment && <p className="text-sm mt-1">{o.review.comment}</p>}</div>}
          </Card>

          <Card className="p-5">
            <h2 className="font-bold text-lg mb-3">History</h2>
            <ol className="relative border-l-2 border-line ml-1.5 space-y-4">
              {o.events.map((e, i) => (
                <li key={i} className="pl-4 relative">
                  <span className="absolute -left-[7px] top-1.5 size-3 rounded-full bg-tarp ring-4 ring-white" aria-hidden />
                  <p className="text-sm font-semibold">{e.from === e.to ? e.note : EVENT_LABEL[e.to] || e.to}</p>
                  {e.from !== e.to && e.note && e.note !== "Order placed" && <p className="text-sm text-muted">{e.note}</p>}
                  <p className="text-xs text-faint">{e.actor}, {dateTime(e.at)}</p>
                </li>
              ))}
            </ol>
          </Card>

          {canCancel && (
            <Button variant="danger" className="w-full" onClick={() => setReason({ open: true, to: "CANCELLED", text: "" })}>
              Cancel order{paid ? " and refund" : ""}
            </Button>
          )}
          <p className="text-xs text-faint flex items-center gap-1.5"><ShieldCheck className="size-3.5" aria-hidden />Every change to this order is recorded above.</p>
        </div>
      </div>

      <Modal open={reason.open} onClose={() => setReason({ open: false, to: null, text: "" })} title={reason.to === "REJECTED" ? "Decline this order?" : "Cancel this order?"}>
        <p className="text-muted mb-4">
          {reason.to === "REJECTED" ? "The buyer is notified and the stock goes back on sale." : `Everyone involved is notified and the stock goes back on sale.${paid ? ` ${rupees(o.total)} is refunded to the buyer.` : ""}`}
        </p>
        <Textarea label="Reason (shared with the other side)" rows={2} value={reason.text} onChange={(e) => setReason({ ...reason, text: e.target.value })}
          placeholder={reason.to === "REJECTED" ? "Harvest delayed, quantity not available…" : "Plans changed…"} />
        <div className="flex justify-end gap-2 mt-5">
          <Button variant="ghost" onClick={() => setReason({ open: false, to: null, text: "" })}>Keep order</Button>
          <Button variant="danger" loading={busy === reason.to} onClick={() => move(reason.to, reason.text || undefined)}>
            {reason.to === "REJECTED" ? "Decline order" : "Cancel order"}
          </Button>
        </div>
      </Modal>

      <DemoCheckout session={demo} onClose={() => setDemo(null)} onPaid={() => { setDemo(null); toast.success("Payment received"); reload(); }} />
    </div>
  );
}

function ActionBox({ title, body, children }) {
  return (
    <div className="rounded-2xl border-2 border-tarp bg-white p-5 sm:p-6">
      <h2 className="text-xl font-bold">{title}</h2>
      {body && <p className="text-muted mt-1 max-w-prose">{body}</p>}
      {children && <div className="flex flex-wrap gap-2 mt-4">{children}</div>}
    </div>
  );
}

// Simulated checkout used only when no Razorpay keys are configured. Clearly labelled; no card data is collected.
function DemoCheckout({ session, onClose, onPaid }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  if (!session) return null;
  const pay = async () => {
    setBusy(true);
    setErr(null);
    try {
      await confirmDemoPayment(session.provider_order_id);
      onPaid();
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal open onClose={onClose} title="Demo payment">
      <div className="rounded-xl bg-turmeric-soft text-[#6b4c00] px-4 py-3 text-sm">
        This deployment runs in demo payment mode. No money moves and no card details are collected. Add Razorpay keys to switch to real checkout.
      </div>
      <div className="mt-5 flex items-baseline justify-between num">
        <span className="text-muted">Order #{session.order_id}</span>
        <span className="font-display text-3xl font-bold">₹{session.amount_display}</span>
      </div>
      {err && <p className="text-sm text-chilli mt-3">{err}</p>}
      <div className="flex justify-end gap-2 mt-6">
        <Button variant="ghost" onClick={onClose}>Not now</Button>
        <Button loading={busy} onClick={pay}>Simulate successful payment</Button>
      </div>
    </Modal>
  );
}
