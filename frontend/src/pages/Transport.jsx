import { Link } from "react-router-dom";
import { ArrowDown, MapPin, Route, Truck } from "lucide-react";
import { useApi } from "../lib/useApi";
import { qty, rupees, when } from "../lib/format";
import { Button, Card, Empty, ErrorNote, PageHeader, PaymentPill, Spinner, StatusPill, cx } from "../components/ui";

function Fit({ match }) {
  const chips = [];
  if (match.fits_vehicle === true) chips.push(["Fits your vehicle", "bg-leaf-soft text-leaf"]);
  if (match.fits_vehicle === false) chips.push(["Bigger than your vehicle", "bg-chilli-soft text-chilli"]);
  if (match.in_service_area) chips.push(["In your area", "bg-tarp-soft text-tarp"]);
  return (
    <div className="flex flex-wrap gap-1.5">
      {chips.map(([t, c]) => <span key={t} className={cx("text-xs font-semibold rounded-md px-2 py-0.5", c)}>{t}</span>)}
    </div>
  );
}

export function Jobs() {
  const { data, error, loading, reload } = useApi("/transport/jobs", { interval: 30000 });
  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 py-8 sm:py-10">
      <PageHeader title="Delivery jobs">
        <Button as={Link} to="/deliveries" variant="secondary">My deliveries</Button>
      </PageHeader>
      <p className="text-muted -mt-4 mb-6">Accepted orders that need a truck. Best matches for your vehicle and area come first.</p>
      <ErrorNote error={error} onRetry={reload} />
      {loading ? <Spinner label="Finding loads" /> : !data?.length ? (
        <Empty icon={Route} title="No loads waiting right now">New jobs appear here the moment a farmer accepts a delivery order. You'll get a notification too.</Empty>
      ) : (
        <ul className="space-y-4">
          {data.map((o) => (
            <li key={o.id}>
              <Card className="p-5 flex flex-wrap gap-5 items-center">
                <div className="flex-1 min-w-60">
                  <div className="flex items-center gap-2 mb-2">
                    <p className="font-display text-xl font-bold num">{qty(o.match.load_kg ?? o.total_qty)} kg</p>
                    <span className="text-muted">{o.items.map((i) => i.crop).join(", ")}</span>
                  </div>
                  <div className="text-sm space-y-0.5">
                    <p className="flex items-center gap-1.5"><MapPin className="size-4 text-leaf" aria-hidden /> {o.pickup_location}</p>
                    <ArrowDown className="size-3.5 text-faint ml-0.5" aria-hidden />
                    <p className="flex items-center gap-1.5"><MapPin className="size-4 text-chilli" aria-hidden /> {o.buyer.location || "Buyer's address"}</p>
                  </div>
                  <div className="mt-3"><Fit match={o.match} /></div>
                </div>
                <div className="text-right">
                  {o.my_quote ? (
                    <p className="text-sm"><span className="text-muted">You quoted </span><span className="font-display text-xl font-bold num">{rupees(o.my_quote.fee)}</span></p>
                  ) : (
                    <p className="text-sm text-muted">{o.quote_count ? `${o.quote_count} quote${o.quote_count > 1 ? "s" : ""} so far` : "No quotes yet"}</p>
                  )}
                  <p className="text-xs text-faint mt-0.5">Posted {when(o.updated_at)}</p>
                  <Button as={Link} to={`/orders/${o.id}`} className="mt-3" variant={o.my_quote ? "secondary" : "primary"}>
                    {o.my_quote ? "View or edit quote" : "Send a quote"}
                  </Button>
                </div>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function Deliveries() {
  const { data, error, loading, reload } = useApi("/transport/deliveries", { interval: 30000 });
  const active = (data || []).filter((o) => ["TRANSPORT_ASSIGNED", "DISPATCHED"].includes(o.status));
  const past = (data || []).filter((o) => !["TRANSPORT_ASSIGNED", "DISPATCHED"].includes(o.status));
  const Row = ({ o }) => (
    <li className="border-b border-line last:border-0">
      <Link to={`/orders/${o.id}`} className="flex flex-wrap gap-3 items-center px-5 py-4 hover:bg-[#fbfcfd]">
        <span className="text-sm text-muted num w-12">#{o.id}</span>
        <span className="flex-1 min-w-48">
          <span className="block font-semibold">{o.pickup_location} to {o.buyer.location}</span>
          <span className="block text-sm text-muted">{o.items.map((i) => i.crop).join(", ")}, {qty(o.total_qty)} kg</span>
        </span>
        <span className="flex flex-col items-end gap-1"><StatusPill status={o.status} /><PaymentPill status={o.payment_status} /></span>
        <span className="w-24 text-right font-display text-lg font-bold num">{rupees(o.transport_fee)}</span>
      </Link>
    </li>
  );
  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 py-8 sm:py-10">
      <PageHeader title="My deliveries"><Button as={Link} to="/jobs" variant="secondary">Find loads</Button></PageHeader>
      <ErrorNote error={error} onRetry={reload} />
      {loading ? <Spinner /> : !data?.length ? (
        <Empty icon={Truck} title="No bookings yet" action={<Button as={Link} to="/jobs">Find loads</Button>}>When a buyer picks your quote, the delivery shows up here.</Empty>
      ) : (
        <>
          {active.length > 0 && <><h2 className="text-xl font-bold mb-3">Current</h2><Card className="overflow-hidden mb-8"><ul>{active.map((o) => <Row key={o.id} o={o} />)}</ul></Card></>}
          {past.length > 0 && <><h2 className="text-xl font-bold mb-3">Past</h2><Card className="overflow-hidden"><ul>{past.map((o) => <Row key={o.id} o={o} />)}</ul></Card></>}
        </>
      )}
    </div>
  );
}
