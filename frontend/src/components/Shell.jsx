import { useEffect, useRef, useState } from "react";
import { Link, NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { Bell, LogOut, Menu, ShoppingBasket, User, X } from "lucide-react";
import { api } from "../lib/api";
import { useCart, useSession } from "../lib/session";
import { useApi } from "../lib/useApi";
import { when } from "../lib/format";
import { cx } from "./ui";

export function Logo({ light }) {
  return (
    <Link to="/" className="flex items-center gap-2 shrink-0" aria-label="FarmFresh home">
      <svg viewBox="0 0 32 32" className="size-8" aria-hidden>
        <rect width="32" height="32" rx="8" fill={light ? "#fff" : "#2747A8"} />
        <path d="M16 25c0-7 2-12 8-15-1 6-3 10-8 15Zm0 0c0-5-2-9-7-11 0 5 2 9 7 11Z" fill="#F2B632" />
      </svg>
      <span className={cx("font-display text-[1.35rem] font-extrabold tracking-tight", light ? "text-white" : "text-ink")}>
        FarmFresh
      </span>
    </Link>
  );
}

const NAV = {
  GUEST: [["/market", "Marketplace"], ["/prices", "Mandi prices"]],
  BUYER: [["/market", "Marketplace"], ["/orders", "My orders"], ["/prices", "Mandi prices"], ["/dashboard", "Spending"]],
  FARMER: [["/dashboard", "Overview"], ["/my-listings", "My produce"], ["/orders", "Orders"], ["/prices", "Mandi prices"]],
  TRANSPORTER: [["/jobs", "Delivery jobs"], ["/deliveries", "My deliveries"], ["/dashboard", "Earnings"]],
  ADMIN: [["/admin", "Overview"], ["/admin/users", "Users"], ["/admin/listings", "Listings"], ["/admin/orders", "Orders"], ["/market", "Marketplace"]],
};

function Notifications() {
  const [open, setOpen] = useState(false);
  const { data, reload, setData } = useApi("/notifications", { interval: 20000 });
  const ref = useRef(null);
  const nav = useNavigate();
  useEffect(() => {
    const close = (e) => ref.current && !ref.current.contains(e.target) && setOpen(false);
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);
  const toggle = async () => {
    setOpen((o) => !o);
    if (!open && data?.unread) {
      await api("/notifications/read", { method: "POST" }).catch(() => {});
      setTimeout(() => setData((d) => d && { ...d, unread: 0 }), 1500);
    }
  };
  const unread = data?.unread || 0;
  return (
    <div className="relative" ref={ref}>
      <button
        onClick={toggle}
        className="relative p-2.5 rounded-xl text-muted hover:text-ink hover:bg-[#eef1f5]"
        aria-label={unread ? `Notifications, ${unread} unread` : "Notifications"}
        aria-expanded={open}
      >
        <Bell className="size-5" />
        {unread > 0 && (
          <span className="absolute top-1 right-1 min-w-4 h-4 px-1 rounded-full bg-chilli text-white text-[0.65rem] font-bold grid place-items-center num">
            {unread > 9 ? "9+" : unread}
          </span>
        )}
      </button>
      {open && (
        <div className="absolute right-0 mt-2 w-[min(22rem,calc(100vw-2rem))] bg-white rounded-2xl border border-line shadow-[0_18px_40px_-12px_rgba(23,32,44,.28)] z-50 overflow-hidden">
          <div className="px-4 py-3 border-b border-line flex justify-between items-center">
            <p className="font-semibold">Notifications</p>
            <button className="text-sm text-tarp" onClick={reload}>
              Refresh
            </button>
          </div>
          <ul className="max-h-96 overflow-auto">
            {!data?.items?.length && <li className="px-4 py-8 text-center text-muted text-sm">You're all caught up.</li>}
            {data?.items?.map((n) => (
              <li key={n.id}>
                <button
                  onClick={() => {
                    setOpen(false);
                    if (n.link) nav(n.link);
                  }}
                  className={cx("w-full text-left px-4 py-3 hover:bg-paper border-b border-line last:border-0", !n.read && "bg-tarp-soft/50")}
                >
                  <p className="text-sm font-semibold leading-snug">{n.title}</p>
                  {n.body && <p className="text-sm text-muted leading-snug mt-0.5">{n.body}</p>}
                  <p className="text-xs text-faint mt-1">{when(n.at)}</p>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

export default function Shell() {
  const { user, logout } = useSession();
  const cart = useCart();
  const [menu, setMenu] = useState(false);
  const loc = useLocation();
  const nav = useNavigate();
  useEffect(() => setMenu(false), [loc.pathname]);
  const links = NAV[user?.role || "GUEST"];

  const linkCls = ({ isActive }) =>
    cx(
      "px-3 py-2 rounded-lg text-[0.95rem] font-medium transition-colors",
      isActive ? "text-tarp bg-tarp-soft" : "text-muted hover:text-ink"
    );

  return (
    <div className="min-h-dvh flex flex-col">
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 bg-white px-3 py-2 rounded-lg z-[60]">
        Skip to content
      </a>
      <header className="sticky top-0 z-40 bg-paper/90 backdrop-blur border-b border-line">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 h-16 flex items-center gap-4">
          <Logo />
          <nav className="hidden lg:flex items-center gap-1 ml-4" aria-label="Main">
            {links.map(([to, label]) => (
              <NavLink key={to} to={to} end={to === "/admin"} className={linkCls}>
                {label}
              </NavLink>
            ))}
          </nav>
          <div className="ml-auto flex items-center gap-1">
            {(!user || user.role === "BUYER") && (
              <Link to="/cart" className="relative p-2.5 rounded-xl text-muted hover:text-ink hover:bg-[#eef1f5]" aria-label={`Basket, ${cart.count} items`}>
                <ShoppingBasket className="size-5" />
                {cart.count > 0 && (
                  <span className="absolute top-1 right-1 min-w-4 h-4 px-1 rounded-full bg-turmeric text-ink text-[0.65rem] font-bold grid place-items-center num">
                    {cart.count}
                  </span>
                )}
              </Link>
            )}
            {user ? (
              <>
                <Notifications />
                <Link to="/profile" className="hidden sm:flex items-center gap-2 pl-2 pr-3 py-1.5 rounded-xl hover:bg-[#eef1f5]">
                  <span className="size-8 rounded-full bg-tarp text-white grid place-items-center font-semibold text-sm">
                    {user.name.slice(0, 1)}
                  </span>
                  <span className="text-sm font-medium max-w-32 truncate">{user.name.split(" ")[0]}</span>
                </Link>
                <button
                  onClick={() => {
                    logout();
                    nav("/");
                  }}
                  className="hidden sm:inline-flex p-2.5 rounded-xl text-muted hover:text-ink hover:bg-[#eef1f5]"
                  aria-label="Log out"
                  title="Log out"
                >
                  <LogOut className="size-5" />
                </button>
              </>
            ) : (
              <div className="hidden sm:flex items-center gap-2 ml-1">
                <Link to="/login" className="px-3 py-2 text-[0.95rem] font-medium text-muted hover:text-ink">
                  Log in
                </Link>
                <Link to="/register" className="h-10 px-4 inline-flex items-center rounded-[10px] bg-tarp text-white font-semibold hover:bg-tarp-deep">
                  Create account
                </Link>
              </div>
            )}
            <button className="lg:hidden p-2.5 rounded-xl text-ink hover:bg-[#eef1f5]" onClick={() => setMenu((m) => !m)} aria-label="Menu" aria-expanded={menu}>
              {menu ? <X className="size-5" /> : <Menu className="size-5" />}
            </button>
          </div>
        </div>
        {menu && (
          <nav className="lg:hidden border-t border-line bg-white px-4 py-3 flex flex-col gap-1" aria-label="Mobile">
            {links.map(([to, label]) => (
              <NavLink key={to} to={to} end={to === "/admin"} className={linkCls}>
                {label}
              </NavLink>
            ))}
            <div className="h-px bg-line my-2" />
            {user ? (
              <>
                <NavLink to="/profile" className={linkCls}>
                  <span className="inline-flex items-center gap-2">
                    <User className="size-4" /> Profile
                  </span>
                </NavLink>
                <button onClick={() => { logout(); nav("/"); }} className="text-left px-3 py-2 text-muted">
                  Log out
                </button>
              </>
            ) : (
              <>
                <NavLink to="/login" className={linkCls}>Log in</NavLink>
                <NavLink to="/register" className={linkCls}>Create account</NavLink>
              </>
            )}
          </nav>
        )}
      </header>
      <main id="main" className="flex-1">
        <Outlet />
      </main>
      <footer className="border-t border-line mt-16">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-8 flex flex-wrap gap-4 justify-between items-center text-sm text-muted">
          <Logo />
          <p>Direct trade between farmers, buyers and transporters across Tamil Nadu and Puducherry.</p>
        </div>
      </footer>
    </div>
  );
}
