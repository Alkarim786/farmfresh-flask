import { useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { ShoppingBasket, Trash2 } from "lucide-react";
import { api } from "../lib/api";
import { useCart, useSession } from "../lib/session";
import { qty, rupees } from "../lib/format";
import { Button, Card, Empty, PageHeader, ProduceArt, Textarea, cx } from "../components/ui";

export default function Cart() {
  const cart = useCart();
  const { user } = useSession();
  const nav = useNavigate();
  const [mode, setMode] = useState("DELIVERY");
  const [address, setAddress] = useState(user?.location || "");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const keys = useRef({}); // one idempotency key per farmer group, reused on retry

  const groups = useMemo(() => {
    const g = {};
    cart.items.forEach((it) => {
      const fid = it.listing.farmer_id;
      (g[fid] ||= { farmer: it.listing.farmer, items: [] }).items.push(it);
    });
    return Object.entries(g);
  }, [cart.items]);

  const total = cart.items.reduce((s, it) => s + it.qty * Number(it.listing.price), 0);

  if (!cart.count) {
    return (
      <div className="max-w-3xl mx-auto px-4 py-10">
        <Empty icon={ShoppingBasket} title="Your basket is empty" action={<Button as={Link} to="/market">Browse produce</Button>}>
          Add produce from any farm. Orders from different farms are sent to each farmer separately.
        </Empty>
      </div>
    );
  }

  const placeOrders = async () => {
    if (!user) return nav("/login", { state: { from: "/cart" } });
    if (user.role !== "BUYER") return toast.error("Log in with a buyer account to place orders.");
    if (mode === "DELIVERY" && address.trim().length < 5) return setError("Add a delivery address so transporters can quote.");
    setBusy(true);
    setError(null);
    const placed = [];
    for (const [fid, g] of groups) {
      keys.current[fid] ||= crypto.randomUUID();
      try {
        const order = await api("/orders", {
          method: "POST",
          headers: { "Idempotency-Key": keys.current[fid] },
          body: {
            items: g.items.map((it) => ({ listing_id: it.listing.id, qty: it.qty })),
            delivery_mode: mode,
            delivery_address: mode === "DELIVERY" ? address : undefined,
            note: note || undefined,
          },
        });
        placed.push(order);
        cart.removeMany(g.items.map((it) => it.listing.id));
        delete keys.current[fid];
      } catch (e) {
        setError(`${g.farmer?.farm_name || g.farmer?.name}: ${e.message}`);
      }
    }
    setBusy(false);
    if (placed.length) {
      toast.success(placed.length === 1 ? `Order #${placed[0].id} sent to the farmer` : `${placed.length} orders sent to farmers`);
      nav(placed.length === 1 ? `/orders/${placed[0].id}` : "/orders");
    }
  };

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 py-8 sm:py-10">
      <PageHeader title="Your basket" />
      <div className="grid lg:grid-cols-[1fr_380px] gap-6 items-start">
        <div className="space-y-5">
          {groups.map(([fid, g]) => (
            <Card key={fid} className="overflow-hidden">
              <div className="px-5 py-3 border-b border-line bg-[#fbfcfd] flex justify-between items-center">
                <p className="font-semibold">{g.farmer?.farm_name || g.farmer?.name}</p>
                <p className="text-sm text-muted">{g.farmer?.location}</p>
              </div>
              <ul>
                {g.items.map(({ listing: l, qty: q }) => {
                  const bad = q < Number(l.min_order_qty) || q > Number(l.qty_available);
                  return (
                    <li key={l.id} className="flex gap-4 p-4 border-b border-line last:border-0 items-center">
                      <ProduceArt listing={l} size="sm" className="size-16 rounded-xl shrink-0" />
                      <div className="flex-1 min-w-0">
                        <Link to={`/listing/${l.id}`} className="font-semibold hover:text-tarp">{l.crop} {l.variety && <span className="text-muted font-normal">{l.variety}</span>}</Link>
                        <p className="text-sm text-muted num">{rupees(l.price)}/{l.unit}</p>
                        {bad && <p className="text-sm text-chilli">Between {qty(l.min_order_qty)} and {qty(l.qty_available)} {l.unit}</p>}
                      </div>
                      <label className="flex items-center gap-1.5">
                        <span className="sr-only">Quantity of {l.crop}</span>
                        <input type="number" inputMode="decimal" className={cx("input !w-20 !py-2 text-center num", bad && "!border-chilli")} value={q}
                          onChange={(e) => cart.setQty(l.id, e.target.value)} />
                        <span className="text-sm text-muted">{l.unit}</span>
                      </label>
                      <p className="w-24 text-right font-semibold num hidden sm:block">{rupees(q * Number(l.price))}</p>
                      <button className="p-2 rounded-lg text-faint hover:text-chilli hover:bg-chilli-soft" onClick={() => cart.remove(l.id)} aria-label={`Remove ${l.crop}`}>
                        <Trash2 className="size-4" />
                      </button>
                    </li>
                  );
                })}
              </ul>
            </Card>
          ))}
        </div>

        <Card className="p-5 lg:sticky lg:top-24">
          <fieldset>
            <legend className="font-semibold mb-2">How should it reach you?</legend>
            <div className="grid grid-cols-2 gap-2">
              {[["DELIVERY", "Deliver to me", "Transporters quote, you choose"], ["PICKUP", "I'll collect", "Pick up from the farm"]].map(([v, t, s]) => (
                <label key={v} className={cx("cursor-pointer rounded-xl border p-3 has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-tarp",
                  mode === v ? "border-tarp bg-tarp-soft" : "border-line hover:border-[#c6cdd8]")}>
                  <input type="radio" name="mode" className="sr-only" checked={mode === v} onChange={() => setMode(v)} />
                  <span className={cx("block font-semibold text-sm", mode === v && "text-tarp")}>{t}</span>
                  <span className="block text-xs text-muted mt-0.5">{s}</span>
                </label>
              ))}
            </div>
          </fieldset>
          {mode === "DELIVERY" && (
            <Textarea label="Delivery address" className="mt-4" rows={2} value={address} onChange={(e) => setAddress(e.target.value)}
              placeholder="Shop / street, area, city" hint="Shared only after the farmer accepts." />
          )}
          <Textarea label="Note for the farmer (optional)" className="mt-4" rows={2} value={note} onChange={(e) => setNote(e.target.value)}
            placeholder="Delivery window, packing preference…" />
          <div className="border-t border-line mt-5 pt-4 space-y-1.5 num">
            <div className="flex justify-between text-muted"><span>Produce</span><span>{rupees(total)}</span></div>
            <div className="flex justify-between text-muted"><span>Delivery</span><span>{mode === "DELIVERY" ? "Quoted later" : "—"}</span></div>
            <div className="flex justify-between font-display text-xl font-bold pt-1"><span>Total now</span><span>{rupees(total)}</span></div>
          </div>
          {error && <p className="text-sm text-chilli mt-3" role="alert">{error}</p>}
          <Button size="lg" className="w-full mt-4" loading={busy} onClick={placeOrders}>
            {groups.length > 1 ? `Send ${groups.length} orders` : "Send order to farmer"}
          </Button>
          <p className="text-sm text-muted mt-3">Nothing is charged now. You'll pay once the farmer accepts{mode === "DELIVERY" ? " and you've picked a transporter" : ""}.</p>
        </Card>
      </div>
    </div>
  );
}
