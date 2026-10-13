import { useState } from "react";
import { Link } from "react-router-dom";
import { ClipboardList } from "lucide-react";
import { Button, Card, Empty, ErrorNote, PageHeader, PaymentPill, Spinner, StatusPill, cx } from "../components/ui";
import { useApi } from "../lib/useApi";
import { useSession } from "../lib/session";
import { qs } from "../lib/api";
import { qty, rupees, when } from "../lib/format";

const TABS = [
  ["active", "In progress"],
  ["PENDING", "Needs response"],
  ["COMPLETED", "Completed"],
  ["REJECTED,CANCELLED", "Declined & cancelled"],
  ["all", "All"],
];

export function OrderTable({ orders, viewer }) {
  return (
    <Card className="overflow-hidden">
      <ul>
        {orders.map((o) => {
          const other = viewer.role === "FARMER" ? o.buyer : o.farmer;
          return (
            <li key={o.id} className="border-b border-line last:border-0">
              <Link to={`/orders/${o.id}`} className="grid grid-cols-[1fr_auto] sm:grid-cols-[5rem_1.6fr_1fr_auto_8rem] gap-x-4 gap-y-1 items-center px-5 py-4 hover:bg-[#fbfcfd]">
                <span className="text-sm text-muted num hidden sm:block">#{o.id}</span>
                <span className="min-w-0">
                  <span className="block font-semibold truncate">{o.items.map((i) => i.crop).join(", ")}</span>
                  <span className="block text-sm text-muted truncate">
                    {viewer.role === "FARMER" ? "From " : ""}
                    {other?.farm_name || other?.name}, {qty(o.total_qty)} {o.items[0]?.unit}, {when(o.created_at)}
                  </span>
                </span>
                <span className="sm:order-none order-first col-span-2 sm:col-span-1 flex items-center gap-2 sm:block">
                  <StatusPill status={o.status} viewer={viewer.role} />
                  <span className="sm:block sm:mt-1"><PaymentPill status={o.payment_status} /></span>
                </span>
                <span className="text-sm text-muted hidden sm:block">{o.delivery_mode === "PICKUP" ? "Pickup" : "Delivery"}</span>
                <span className="text-right font-display text-lg font-bold num">{rupees(viewer.role === "FARMER" ? o.subtotal : o.total)}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}

export default function Orders() {
  const { user } = useSession();
  const [tab, setTab] = useState(user.role === "FARMER" ? "PENDING" : "active");
  const params = tab === "active" ? { active: 1 } : tab === "all" ? {} : { status: tab };
  const { data, error, loading, reload } = useApi(`/orders${qs({ ...params, page_size: 50 })}`, { interval: 30000 });

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 py-8 sm:py-10">
      <PageHeader title={user.role === "FARMER" ? "Orders for your produce" : "My orders"}>
        {user.role === "BUYER" && <Button as={Link} to="/market" variant="secondary">Buy more produce</Button>}
      </PageHeader>
      <div className="flex gap-1 overflow-x-auto scrollbar-none mb-5 border-b border-line" role="tablist">
        {TABS.map(([v, label]) => (
          <button key={v} role="tab" aria-selected={tab === v} onClick={() => setTab(v)}
            className={cx("px-3.5 py-2.5 text-sm font-semibold whitespace-nowrap border-b-2 -mb-px",
              tab === v ? "border-tarp text-tarp" : "border-transparent text-muted hover:text-ink")}>
            {label}
          </button>
        ))}
      </div>
      <ErrorNote error={error} onRetry={reload} />
      {loading ? (
        <Spinner label="Loading orders" />
      ) : data?.items?.length ? (
        <OrderTable orders={data.items} viewer={user} />
      ) : (
        <Empty icon={ClipboardList} title="No orders here"
          action={user.role === "BUYER" ? <Button as={Link} to="/market">Browse produce</Button> : user.role === "FARMER" ? <Button as={Link} to="/my-listings">Manage produce</Button> : null}>
          {user.role === "FARMER" ? "When buyers order your produce it shows up here for you to accept." : "Orders you place will show up here with live status."}
        </Empty>
      )}
    </div>
  );
}
