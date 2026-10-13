import { useState } from "react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { api, qs } from "../lib/api";
import { useApi } from "../lib/useApi";
import { rupees, when } from "../lib/format";
import { Button, Card, ErrorNote, PageHeader, PaymentPill, ProduceArt, Select, Spinner, Stat, StatusPill, Verified, cx } from "../components/ui";

export function AdminHome() {
  const { data: d, error, loading } = useApi("/dashboard");
  if (loading) return <Spinner />;
  if (error) return <div className="p-6"><ErrorNote error={error} /></div>;
  const totalUsers = Object.values(d.users).reduce((a, b) => a + b, 0);
  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 py-8 sm:py-10">
      <PageHeader title="Platform overview" />
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <Stat label="Paid order value" value={rupees(d.gmv, true)} />
        <Stat label="Accounts" value={totalUsers} />
        <Stat label="Waiting for verification" value={d.unverified} tone={d.unverified ? "text-chilli" : undefined} />
        <Stat label="Orders completed" value={d.status_counts.COMPLETED || 0} />
      </div>
      <div className="grid lg:grid-cols-[1.5fr_1fr] gap-6 mt-8">
        <Card className="p-5">
          <h2 className="text-xl font-bold mb-3">Order value by month</h2>
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={d.monthly.map((m) => ({ ...m, amount: +m.amount }))} margin={{ left: -6, right: 4 }}>
              <CartesianGrid vertical={false} stroke="#e2e6ec" />
              <XAxis dataKey="month" tick={{ fontSize: 12, fill: "#8a94a3" }} tickLine={false} axisLine={false} />
              <YAxis tick={{ fontSize: 12, fill: "#8a94a3" }} tickLine={false} axisLine={false} width={56} tickFormatter={(v) => `₹${(v / 1000).toFixed(0)}k`} />
              <Tooltip cursor={{ fill: "#e8edfa" }} formatter={(v) => [rupees(v), "Order value"]} contentStyle={{ borderRadius: 12, border: "1px solid #e2e6ec" }} />
              <Bar dataKey="amount" fill="#2747a8" radius={[6, 6, 0, 0]} maxBarSize={44} />
            </BarChart>
          </ResponsiveContainer>
        </Card>
        <Card className="p-5">
          <h2 className="text-xl font-bold mb-3">Accounts by role</h2>
          <ul className="space-y-2">
            {Object.entries(d.users).map(([role, n]) => (
              <li key={role} className="flex justify-between"><span className="capitalize">{role.toLowerCase()}s</span><span className="font-semibold num">{n}</span></li>
            ))}
          </ul>
          <h2 className="text-xl font-bold mt-6 mb-3">Top crops by value</h2>
          <ul className="space-y-2">
            {d.top_crops.map((c) => (
              <li key={c.crop} className="flex justify-between"><span>{c.crop}</span><span className="font-semibold num">{rupees(c.revenue, true)}</span></li>
            ))}
          </ul>
        </Card>
      </div>
      <Card className="p-5 mt-6">
        <h2 className="text-xl font-bold mb-3">Orders by status</h2>
        <div className="flex flex-wrap gap-3">
          {Object.entries(d.status_counts).map(([s, n]) => (
            <Link key={s} to={`/admin/orders?status=${s}`} className="flex items-center gap-2 rounded-xl border border-line px-3 py-2 hover:border-tarp">
              <StatusPill status={s} /><span className="font-semibold num">{n}</span>
            </Link>
          ))}
        </div>
      </Card>
    </div>
  );
}

export function AdminUsers() {
  const [filters, setFilters] = useState({ role: "", q: "", unverified: "" });
  const { data, error, loading, reload } = useApi(`/admin/users${qs({ ...filters, page_size: 50 })}`);
  const update = async (u, patch, msg) => {
    try {
      await api(`/admin/users/${u.id}`, { method: "PATCH", body: patch });
      toast.success(msg);
      reload();
    } catch (e) {
      toast.error(e.message);
    }
  };
  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 py-8 sm:py-10">
      <PageHeader title="Users" />
      <div className="flex flex-wrap gap-3 mb-4 items-end">
        <input className="input !w-64" placeholder="Search name or email" value={filters.q} onChange={(e) => setFilters({ ...filters, q: e.target.value })} aria-label="Search users" />
        <Select value={filters.role} onChange={(e) => setFilters({ ...filters, role: e.target.value })} aria-label="Role" className="w-44">
          <option value="">All roles</option><option value="FARMER">Farmers</option><option value="BUYER">Buyers</option><option value="TRANSPORTER">Transporters</option><option value="ADMIN">Admins</option>
        </Select>
        <label className="flex items-center gap-2 h-11 text-sm font-semibold">
          <input type="checkbox" className="size-4 accent-[#2747a8]" checked={!!filters.unverified} onChange={(e) => setFilters({ ...filters, unverified: e.target.checked ? "1" : "" })} />
          Not verified
        </label>
      </div>
      <ErrorNote error={error} onRetry={reload} />
      {loading ? <Spinner /> : (
        <Card className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="text-left text-muted border-b border-line"><th className="font-medium px-5 py-3">Name</th><th className="font-medium px-3 py-3">Role</th><th className="font-medium px-3 py-3">Joined</th><th className="font-medium px-3 py-3">Status</th><th className="px-5 py-3" /></tr></thead>
            <tbody>
              {data?.items.map((u) => (
                <tr key={u.id} className="border-b border-line last:border-0">
                  <td className="px-5 py-3"><span className="font-semibold flex items-center gap-1">{u.farm_name || u.name}{u.verified && <Verified />}</span><span className="text-muted">{u.email}</span></td>
                  <td className="px-3 py-3 capitalize">{u.role.toLowerCase()}</td>
                  <td className="px-3 py-3 text-muted">{when(u.created_at)}</td>
                  <td className="px-3 py-3">{u.active ? <span className="text-leaf font-semibold">Active</span> : <span className="text-chilli font-semibold">Suspended</span>}</td>
                  <td className="px-5 py-3 text-right whitespace-nowrap">
                    {u.role !== "ADMIN" && (
                      <div className="inline-flex gap-1.5">
                        <Button size="sm" variant={u.verified ? "ghost" : "secondary"} onClick={() => update(u, { verified: !u.verified }, u.verified ? "Verification removed" : `${u.name} verified`)}>
                          {u.verified ? "Unverify" : "Verify"}
                        </Button>
                        <Button size="sm" variant={u.active ? "danger" : "secondary"} onClick={() => update(u, { active: !u.active }, u.active ? `${u.name} suspended` : `${u.name} reinstated`)}>
                          {u.active ? "Suspend" : "Reinstate"}
                        </Button>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  );
}

export function AdminListings() {
  const { data, error, loading, reload } = useApi("/admin/listings?page_size=60");
  const moderate = async (l, hidden) => {
    const reason = hidden ? window.prompt("Reason shown to the farmer:", "Photos or description don't match the produce") : null;
    if (hidden && reason === null) return;
    try {
      await api(`/admin/listings/${l.id}`, { method: "PATCH", body: { hidden, reason } });
      toast.success(hidden ? "Listing hidden" : "Listing restored");
      reload();
    } catch (e) {
      toast.error(e.message);
    }
  };
  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 py-8 sm:py-10">
      <PageHeader title="Listings" />
      <ErrorNote error={error} onRetry={reload} />
      {loading ? <Spinner /> : (
        <Card className="overflow-hidden">
          <ul>
            {data?.items.map((l) => (
              <li key={l.id} className="flex flex-wrap gap-4 items-center p-4 border-b border-line last:border-0">
                <ProduceArt listing={l} size="sm" className="size-14 rounded-xl" />
                <div className="flex-1 min-w-48">
                  <Link to={`/listing/${l.id}`} className="font-semibold hover:text-tarp">{l.crop} {l.variety}</Link>
                  <p className="text-sm text-muted">{l.farmer?.farm_name || l.farmer?.name}, {l.location}</p>
                </div>
                <span className="num font-semibold">{rupees(l.price)}/{l.unit}</span>
                <span className={cx("text-xs font-semibold rounded-full px-2.5 py-0.5", l.status === "HIDDEN" ? "bg-chilli-soft text-chilli" : "bg-[#eef1f5] text-muted")}>{l.status.replace("_", " ").toLowerCase()}</span>
                <Button size="sm" variant={l.status === "HIDDEN" ? "secondary" : "danger"} onClick={() => moderate(l, l.status !== "HIDDEN")}>
                  {l.status === "HIDDEN" ? "Restore" : "Hide"}
                </Button>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}

export function AdminOrders() {
  const status = new URLSearchParams(location.search).get("status") || "";
  const [s, setS] = useState(status);
  const { data, error, loading } = useApi(`/admin/orders${qs({ status: s, page_size: 60 })}`);
  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 py-8 sm:py-10">
      <PageHeader title="All orders">
        <Select value={s} onChange={(e) => setS(e.target.value)} aria-label="Status" className="w-52">
          <option value="">Every status</option>
          {["PENDING", "ACCEPTED", "TRANSPORT_ASSIGNED", "DISPATCHED", "DELIVERED", "COMPLETED", "REJECTED", "CANCELLED"].map((x) => <option key={x} value={x}>{x.replace("_", " ").toLowerCase()}</option>)}
        </Select>
      </PageHeader>
      <ErrorNote error={error} />
      {loading ? <Spinner /> : (
        <Card className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="text-left text-muted border-b border-line"><th className="font-medium px-5 py-3">Order</th><th className="font-medium px-3 py-3">Farmer → Buyer</th><th className="font-medium px-3 py-3">Status</th><th className="font-medium px-5 py-3 text-right">Total</th></tr></thead>
            <tbody>
              {data?.items.map((o) => (
                <tr key={o.id} className="border-b border-line last:border-0 hover:bg-[#fbfcfd]">
                  <td className="px-5 py-3"><Link to={`/orders/${o.id}`} className="font-semibold text-tarp num">#{o.id}</Link><span className="block text-muted">{when(o.created_at)}</span></td>
                  <td className="px-3 py-3">{o.farmer.farm_name || o.farmer.name} → {o.buyer.name}<span className="block text-muted">{o.items.map((i) => i.crop).join(", ")}</span></td>
                  <td className="px-3 py-3"><StatusPill status={o.status} /><span className="block mt-1"><PaymentPill status={o.payment_status} /></span></td>
                  <td className="px-5 py-3 text-right font-semibold num">{rupees(o.total)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  );
}
