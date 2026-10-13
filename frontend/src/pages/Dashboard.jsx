import { Link } from "react-router-dom";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { useApi } from "../lib/useApi";
import { useSession } from "../lib/session";
import { qty, rupees } from "../lib/format";
import { Button, Card, ErrorNote, PageHeader, Spinner, Stars, Stat } from "../components/ui";
import { OrderTable } from "./Orders";
import { RateBoard } from "../components/Produce";

function MonthlyChart({ data, label }) {
  if (!data?.length) return <p className="text-muted py-10 text-center">No paid orders in the last six months yet.</p>;
  const rows = data.map((d) => ({ ...d, amount: Number(d.amount) }));
  return (
    <ResponsiveContainer width="100%" height={260}>
      <BarChart data={rows} margin={{ top: 8, right: 4, bottom: 0, left: -6 }}>
        <CartesianGrid vertical={false} stroke="#e2e6ec" />
        <XAxis dataKey="month" tick={{ fontSize: 12, fill: "#8a94a3" }} tickLine={false} axisLine={false} />
        <YAxis tick={{ fontSize: 12, fill: "#8a94a3" }} tickLine={false} axisLine={false} width={56}
          tickFormatter={(v) => (v >= 1000 ? `₹${(v / 1000).toFixed(0)}k` : `₹${v}`)} />
        <Tooltip cursor={{ fill: "#e8edfa" }} formatter={(v) => [rupees(v), label]}
          contentStyle={{ borderRadius: 12, border: "1px solid #e2e6ec", fontFamily: "Instrument Sans" }} />
        <Bar dataKey="amount" fill="#2747a8" radius={[6, 6, 0, 0]} maxBarSize={44} />
      </BarChart>
    </ResponsiveContainer>
  );
}

export default function Dashboard() {
  const { user } = useSession();
  const { data: d, error, loading, reload } = useApi("/dashboard");
  const pending = useApi(user.role === "FARMER" ? "/orders?status=PENDING&page_size=5" : user.role === "BUYER" ? "/orders?active=1&page_size=5" : null);

  if (loading) return <Spinner />;
  if (error) return <div className="max-w-3xl mx-auto p-6"><ErrorNote error={error} onRetry={reload} /></div>;

  const first = user.name.split(" ")[0];
  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 py-8 sm:py-10">
      <PageHeader title={user.role === "FARMER" ? `Vanakkam, ${first}` : user.role === "BUYER" ? "Your spending" : "Your earnings"}>
        {user.role === "FARMER" && <Button as={Link} to="/my-listings?new=1">List a harvest</Button>}
        {user.role === "TRANSPORTER" && <Button as={Link} to="/jobs">Find loads</Button>}
      </PageHeader>

      {user.role === "FARMER" && (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <Stat label="Received from buyers" value={rupees(d.earned, true)} />
            <Stat label="Orders to respond to" value={d.pending_orders} tone={d.pending_orders ? "text-chilli" : undefined} />
            <Stat label="Listings on sale" value={d.live_listings} />
            <Card className="p-5"><p className="text-sm text-muted">Buyer rating</p><div className="mt-2"><Stars value={d.rating.average} count={d.rating.count} className="!text-xl" /></div></Card>
          </div>
          {pending.data?.items?.length > 0 && (
            <section className="mt-8">
              <h2 className="text-xl font-bold mb-3">Waiting for your answer</h2>
              <OrderTable orders={pending.data.items} viewer={user} />
            </section>
          )}
          <Card className="p-5 mt-8"><h2 className="text-xl font-bold mb-3">Sales by month</h2><MonthlyChart data={d.monthly} label="Sales" /></Card>
          <div className="grid lg:grid-cols-2 gap-6 mt-6 items-start">
            <Card className="p-5">
              <h2 className="text-xl font-bold mb-3">Best-selling produce</h2>
              {d.top_crops.length ? (
                <ul className="space-y-3">
                  {d.top_crops.map((c) => {
                    const max = Number(d.top_crops[0].revenue);
                    return (
                      <li key={c.crop}>
                        <div className="flex justify-between text-sm num"><span className="font-semibold">{c.crop}</span><span>{rupees(c.revenue, true)}</span></div>
                        <div className="h-2 rounded-full bg-paper mt-1"><div className="h-2 rounded-full bg-turmeric" style={{ width: `${(Number(c.revenue) / max) * 100}%` }} /></div>
                        <p className="text-xs text-muted mt-0.5 num">{qty(c.qty)} kg sold</p>
                      </li>
                    );
                  })}
                </ul>
              ) : <p className="text-muted">Sales will show here.</p>}
            </Card>
            <RateBoard compact />
          </div>
        </>
      )}

      {user.role === "BUYER" && (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <Stat label="Paid so far" value={rupees(d.spent, true)} />
            <Stat label="Orders completed" value={d.status_counts.COMPLETED || 0} />
            <Stat label="In progress" value={Object.entries(d.status_counts).filter(([s]) => !["COMPLETED", "REJECTED", "CANCELLED"].includes(s)).reduce((a, [, n]) => a + n, 0)} />
            <Stat label="Declined or cancelled" value={(d.status_counts.REJECTED || 0) + (d.status_counts.CANCELLED || 0)} />
          </div>
          <Card className="p-5 mt-8"><h2 className="text-xl font-bold mb-3">Spending by month</h2><MonthlyChart data={d.monthly} label="Spent" /></Card>
          {pending.data?.items?.length > 0 && (
            <section className="mt-8"><h2 className="text-xl font-bold mb-3">In progress</h2><OrderTable orders={pending.data.items} viewer={user} /></section>
          )}
        </>
      )}

      {user.role === "TRANSPORTER" && (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <Stat label="Earned from deliveries" value={rupees(d.earned, true)} />
            <Stat label="Loads waiting for quotes" value={d.open_jobs} tone="text-tarp" />
            <Stat label="Your open quotes" value={d.open_quotes} />
            <Stat label="Deliveries done" value={(d.status_counts.DELIVERED || 0) + (d.status_counts.COMPLETED || 0)} />
          </div>
          <Card className="p-5 mt-8"><h2 className="text-xl font-bold mb-3">Earnings by month</h2><MonthlyChart data={d.monthly} label="Earned" /></Card>
        </>
      )}
    </div>
  );
}
