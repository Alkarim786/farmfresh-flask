import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { api, loadSession, saveSession, setLogoutHandler } from "./api";

const SessionCtx = createContext(null);
const CartCtx = createContext(null);
const CART_KEY = "farmfresh.cart";

export function SessionProvider({ children }) {
  const [session, setSession] = useState(loadSession);

  const logout = useCallback(() => {
    saveSession(null);
    setSession(null);
  }, []);

  useEffect(() => setLogoutHandler(logout), [logout]);

  const login = useCallback((data) => {
    saveSession(data);
    setSession(data);
  }, []);

  const refreshUser = useCallback(async () => {
    const user = await api("/auth/me");
    setSession((s) => {
      const next = { ...s, user };
      saveSession(next);
      return next;
    });
  }, []);

  const value = useMemo(
    () => ({ user: session?.user || null, login, logout, refreshUser }),
    [session, login, logout, refreshUser]
  );
  return <SessionCtx.Provider value={value}>{children}</SessionCtx.Provider>;
}

export const useSession = () => useContext(SessionCtx);

// Cart: { [listingId]: { listing, qty } }. Checkout splits it into one order per farmer.
export function CartProvider({ children }) {
  const [cart, setCart] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem(CART_KEY)) || {};
    } catch {
      return {};
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem(CART_KEY, JSON.stringify(cart));
    } catch {
      /* ignore */
    }
  }, [cart]);

  const value = useMemo(() => {
    const items = Object.values(cart);
    return {
      items,
      count: items.length,
      add: (listing, qty) => setCart((c) => ({ ...c, [listing.id]: { listing, qty: Number(qty) } })),
      setQty: (id, qty) => setCart((c) => (c[id] ? { ...c, [id]: { ...c[id], qty: Number(qty) } } : c)),
      remove: (id) =>
        setCart((c) => {
          const n = { ...c };
          delete n[id];
          return n;
        }),
      removeMany: (ids) =>
        setCart((c) => {
          const n = { ...c };
          ids.forEach((id) => delete n[id]);
          return n;
        }),
      has: (id) => Boolean(cart[id]),
    };
  }, [cart]);
  return <CartCtx.Provider value={value}>{children}</CartCtx.Provider>;
}

export const useCart = () => useContext(CartCtx);
