import { useState } from "react";
import { Link, useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import { Sprout, Store, Truck } from "lucide-react";
import { api } from "../lib/api";
import { useSession } from "../lib/session";
import { Button, Card, Input, cx } from "../components/ui";

export const HOME_FOR = { FARMER: "/dashboard", BUYER: "/market", TRANSPORTER: "/jobs", ADMIN: "/admin" };

const DEMO = [
  ["Farmer", "farmer@farmfresh.demo"],
  ["Buyer", "buyer@farmfresh.demo"],
  ["Transporter", "transport@farmfresh.demo"],
  ["Admin", "admin@farmfresh.demo"],
];

function AuthFrame({ title, sub, children }) {
  return (
    <div className="max-w-md mx-auto px-4 py-12 sm:py-16">
      <h1 className="text-[2.2rem] font-extrabold">{title}</h1>
      {sub && <p className="text-muted mt-1.5">{sub}</p>}
      <Card className="p-6 mt-7">{children}</Card>
    </div>
  );
}

export function Login() {
  const { login } = useSession();
  const nav = useNavigate();
  const loc = useLocation();
  const [form, setForm] = useState({ email: "", password: "" });
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e, creds = form) => {
    e?.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const data = await api("/auth/login", { method: "POST", body: creds, auth: false });
      login(data);
      toast.success(`Welcome back, ${data.user.name.split(" ")[0]}`);
      nav(loc.state?.from || HOME_FOR[data.user.role], { replace: true });
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthFrame title="Log in" sub="Pick up where you left off.">
      <form onSubmit={submit} className="space-y-4" noValidate>
        <Input label="Email" type="email" autoComplete="email" required value={form.email}
          onChange={(e) => setForm({ ...form, email: e.target.value })} />
        <Input label="Password" type="password" autoComplete="current-password" required value={form.password}
          onChange={(e) => setForm({ ...form, password: e.target.value })} />
        {error && <p className="text-sm text-chilli" role="alert">{error}</p>}
        <Button type="submit" className="w-full" loading={busy}>Log in</Button>
      </form>
      <p className="text-sm text-muted mt-5 text-center">
        New here? <Link className="text-tarp font-semibold" to="/register">Create an account</Link>
      </p>
      <div className="mt-6 pt-5 border-t border-line">
        <p className="text-sm font-semibold">Try a demo account</p>
        <p className="text-sm text-muted">Each one is filled with sample orders and listings.</p>
        <div className="grid grid-cols-2 gap-2 mt-3">
          {DEMO.map(([label, email]) => (
            <Button key={email} variant="secondary" size="sm" disabled={busy}
              onClick={() => submit(null, { email, password: "farmfresh123" })}>
              {label}
            </Button>
          ))}
        </div>
      </div>
    </AuthFrame>
  );
}

const ROLE_OPTS = [
  ["FARMER", "I grow produce", Sprout],
  ["BUYER", "I buy produce", Store],
  ["TRANSPORTER", "I move produce", Truck],
];

export function Register() {
  const [params] = useSearchParams();
  const { login } = useSession();
  const nav = useNavigate();
  const [role, setRole] = useState(params.get("role") || "BUYER");
  const [form, setForm] = useState({});
  const [errors, setErrors] = useState({});
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setErrors({});
    try {
      const data = await api("/auth/register", { method: "POST", body: { ...form, role }, auth: false });
      login(data);
      toast.success("Account created");
      nav(role === "FARMER" ? "/my-listings?new=1" : HOME_FOR[role], { replace: true });
    } catch (err) {
      setError(err.message);
      setErrors(err.fields);
    } finally {
      setBusy(false);
    }
  };
  const fe = (k) => (errors[k] ? (k === Object.keys(errors)[0] ? error : "Check this field") : undefined);

  return (
    <AuthFrame title="Create your account" sub="Free for farmers, buyers and transporters.">
      <form onSubmit={submit} className="space-y-4" noValidate>
        <fieldset>
          <legend className="text-sm font-semibold mb-2">I'm joining as</legend>
          <div className="grid grid-cols-3 gap-2">
            {ROLE_OPTS.map(([value, label, Icon]) => (
              <label key={value}
                className={cx("cursor-pointer rounded-xl border p-3 text-center text-sm transition-colors has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-tarp",
                  role === value ? "border-tarp bg-tarp-soft text-tarp font-semibold" : "border-line text-muted hover:border-[#c6cdd8]")}>
                <input type="radio" name="role" value={value} checked={role === value} onChange={() => setRole(value)} className="sr-only" />
                <Icon className="size-5 mx-auto mb-1" aria-hidden />
                {label}
              </label>
            ))}
          </div>
        </fieldset>
        <Input label="Full name" autoComplete="name" required onChange={set("name")} error={fe("name")} />
        <Input label="Email" type="email" autoComplete="email" required onChange={set("email")} error={fe("email")} />
        <Input label="Phone" type="tel" autoComplete="tel" placeholder="+91 98765 43210" onChange={set("phone")} error={fe("phone")}
          hint="Shared with your trading partner only after an order is accepted." />
        <Input label="Password" type="password" autoComplete="new-password" required minLength={8} onChange={set("password")}
          error={fe("password")} hint="At least 8 characters." />
        <Input label={role === "FARMER" ? "Village / town" : "City"} placeholder={role === "FARMER" ? "Villupuram, Tamil Nadu" : "Puducherry"}
          onChange={set("location")} />
        {role === "FARMER" && <Input label="Farm name" placeholder="Selvam Family Farm" onChange={set("farm_name")} />}
        {role === "BUYER" && <Input label="Business type" placeholder="Restaurant, retailer, household…" onChange={set("business_type")} />}
        {role === "TRANSPORTER" && (
          <>
            <div className="grid grid-cols-2 gap-3">
              <Input label="Vehicle" placeholder="Tata Ace" onChange={set("vehicle_type")} />
              <Input label="Capacity (kg)" type="number" inputMode="numeric" placeholder="750" onChange={set("vehicle_capacity_kg")}
                error={fe("vehicle_capacity_kg")} />
            </div>
            <Input label="Areas you serve" placeholder="Villupuram, Puducherry, Chennai" onChange={set("service_area")}
              hint="Comma separated. Used to match you with nearby loads." />
          </>
        )}
        {error && !Object.keys(errors).length && <p className="text-sm text-chilli" role="alert">{error}</p>}
        <Button type="submit" className="w-full" loading={busy}>Create account</Button>
      </form>
      <p className="text-sm text-muted mt-5 text-center">
        Already have an account? <Link className="text-tarp font-semibold" to="/login">Log in</Link>
      </p>
    </AuthFrame>
  );
}
