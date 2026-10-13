import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { toast } from "sonner";
import { CalendarDays, MapPin, Minus, Package, Plus } from "lucide-react";
import PriceChart from "../components/PriceChart";
import { Button, Card, ErrorNote, MarketChip, ProduceArt, Spinner, Stars, Verified, cx } from "../components/ui";
import { useApi } from "../lib/useApi";
import { useCart, useSession } from "../lib/session";
import { qs } from "../lib/api";
import { diffVsMarket, qty, rupees, shortDate } from "../lib/format";

export default function ListingDetail() {
  const { id } = useParams();
  const { user } = useSession();
  const cart = useCart();
  const nav = useNavigate();
  const { data: l, error, loading } = useApi(`/listings/${id}`);
  const prices = useApi(l && l.unit === "kg" ? `/prices${qs({ commodity: l.crop, days: 60 })}` : null);
  const [amount, setAmount] = useState("");
  const [img, setImg] = useState(0);

  useEffect(() => {
    if (l) setAmount(String(Math.max(Number(l.min_order_qty), Math.min(Number(l.qty_available), Number(l.min_order_qty) * 2))));
  }, [l]);

  if (loading) return <Spinner />;
  if (error) return <div className="max-w-3xl mx-auto p-6"><ErrorNote error={error} /></div>;

  const n = Number(amount);
  const min = Number(l.min_order_qty), max = Number(l.qty_available);
  const invalid = !n || n < min || n > max;
  const step = l.unit === "kg" ? (max >= 200 ? 10 : 5) : 1;
  const d = diffVsMarket(l.price, l.market);
  const mine = user?.id === l.farmer_id;
  const canBuy = !user || user.role === "BUYER";

  const add = () => {
    cart.add(l, n);
    toast.success(`${qty(n)} ${l.unit} of ${l.crop} added to basket`, { action: { label: "View basket", onClick: () => nav("/cart") } });
  };

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 py-8 sm:py-10">
      <Link to="/market" className="text-sm text-muted hover:text-ink">← Marketplace</Link>
      <div className="grid lg:grid-cols-[1.15fr_1fr] gap-8 lg:gap-12 mt-4">
        <div>
          {l.images.length ? (
            <>
              <img src={l.images[img]} alt={`${l.crop} from ${l.location}`} className="w-full aspect-[4/3] object-cover rounded-2xl border border-line" />
              {l.images.length > 1 && (
                <div className="flex gap-2 mt-3">
                  {l.images.map((src, i) => (
                    <button key={src} onClick={() => setImg(i)} aria-label={`Photo ${i + 1}`}
                      className={cx("size-20 rounded-xl overflow-hidden border-2", i === img ? "border-tarp" : "border-transparent")}>
                      <img src={src} alt="" className="size-full object-cover" />
                    </button>
                  ))}
                </div>
              )}
            </>
          ) : (
            <ProduceArt listing={l} size="lg" className="w-full aspect-[4/3] rounded-2xl border border-line" />
          )}

          {prices.data?.series?.length > 0 && (
            <Card className="p-5 mt-6">
              <div className="flex flex-wrap items-baseline justify-between gap-2 mb-3">
                <h2 className="text-xl font-bold">{l.crop} at the mandi, last 60 days</h2>
                <Link to={`/prices?commodity=${encodeURIComponent(l.crop)}`} className="text-sm font-semibold text-tarp">Market by market</Link>
              </div>
              <PriceChart series={prices.data.series} mine={l.price} height={220} />
              <p className="text-sm text-muted mt-2">
                Blue line is the median modal price; the shaded band is the lowest to highest trade reported each day
                {prices.data.source === "sample" ? " (sample reference data)" : " (AGMARKNET)"}.
              </p>
            </Card>
          )}
        </div>

        <div>
          <div className="flex flex-wrap gap-2 mb-3">
            <span className="rounded-md bg-white border border-line text-sm font-semibold px-2 py-0.5">Grade {l.grade}</span>
            {l.organic && <span className="rounded-md bg-leaf-soft text-leaf text-sm font-semibold px-2 py-0.5">Organic</span>}
          </div>
          <h1 className="text-[2.6rem] sm:text-5xl font-extrabold leading-none">{l.crop}</h1>
          {l.variety && <p className="text-xl text-muted mt-1">{l.variety}</p>}

          <div className="mt-6 flex items-end gap-3 flex-wrap">
            <p className="num">
              <span className="font-display text-5xl font-extrabold">{rupees(l.price)}</span>
              <span className="text-muted text-lg"> per {l.unit}</span>
            </p>
            <MarketChip price={l.price} market={l.market} className="mb-2" />
          </div>
          {l.market && d !== null && (
            <p className="text-sm text-muted mt-2 num">
              Mandi median is {rupees(l.market.median)}/{l.unit} across {l.market.markets} reports this week.
            </p>
          )}

          <dl className="grid grid-cols-3 gap-3 mt-6">
            {[
              [Package, "Available", `${qty(l.qty_available)} ${l.unit}`],
              [MapPin, "Pickup", l.location],
              [CalendarDays, "Harvested", l.harvest_date ? shortDate(l.harvest_date) : "—"],
            ].map(([Icon, k, v]) => (
              <div key={k} className="bg-white border border-line rounded-xl p-3">
                <dt className="text-xs text-muted flex items-center gap-1"><Icon className="size-3.5" aria-hidden />{k}</dt>
                <dd className="font-semibold mt-0.5 text-sm leading-snug num">{v}</dd>
              </div>
            ))}
          </dl>

          {l.description && <p className="mt-6 text-[1.05rem] leading-relaxed max-w-prose">{l.description}</p>}

          {canBuy && (
            <Card className="p-5 mt-7">
              <label htmlFor="qty" className="text-sm font-semibold">How much do you need?</label>
              <div className="flex items-center gap-3 mt-2">
                <div className="flex items-center border border-line rounded-xl overflow-hidden">
                  <button className="p-3 hover:bg-paper disabled:opacity-40" aria-label="Less" disabled={n - step < min}
                    onClick={() => setAmount(String(Math.max(min, n - step)))}><Minus className="size-4" /></button>
                  <input id="qty" type="number" inputMode="decimal" className="w-20 text-center font-semibold num outline-none py-2.5"
                    value={amount} min={min} max={max} onChange={(e) => setAmount(e.target.value)} />
                  <button className="p-3 hover:bg-paper disabled:opacity-40" aria-label="More" disabled={n + step > max}
                    onClick={() => setAmount(String(Math.min(max, n + step)))}><Plus className="size-4" /></button>
                </div>
                <span className="text-muted">{l.unit}</span>
                <span className="ml-auto font-display text-2xl font-bold num">{invalid ? "—" : rupees(n * Number(l.price))}</span>
              </div>
              <p className={cx("text-sm mt-2", invalid && amount ? "text-chilli" : "text-faint")}>
                Minimum {qty(min)} {l.unit}, up to {qty(max)} {l.unit}.
              </p>
              <Button className="w-full mt-4" size="lg" disabled={invalid} onClick={add}>
                {cart.has(l.id) ? "Update basket" : "Add to basket"}
              </Button>
              <p className="text-sm text-muted mt-3">
                The farmer confirms your order first. You pay only after it's accepted and a truck is booked.
              </p>
            </Card>
          )}
          {mine && (
            <Button as={Link} to="/my-listings" variant="secondary" className="mt-6">Manage this listing</Button>
          )}

          <Card className="p-5 mt-6">
            <p className="text-sm text-muted">Sold by</p>
            <Link to={`/farmers/${l.farmer.id}`} className="flex items-center gap-1.5 mt-1 text-lg font-bold hover:text-tarp">
              {l.farmer.farm_name || l.farmer.name}
              {l.farmer.verified && <Verified />}
            </Link>
            <p className="text-sm text-muted">{l.farmer.name}, {l.farmer.location}</p>
            <Stars value={l.farmer.rating?.average} count={l.farmer.rating?.count} className="mt-2" />
          </Card>
        </div>
      </div>
    </div>
  );
}
