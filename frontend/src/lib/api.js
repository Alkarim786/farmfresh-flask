// Small fetch wrapper: JSON in/out, bearer auth, one automatic token refresh on 401.
const KEY = "farmfresh.session";

export function loadSession() {
  try {
    return JSON.parse(localStorage.getItem(KEY)) || null;
  } catch {
    return null;
  }
}

export function saveSession(s) {
  try {
    if (s) localStorage.setItem(KEY, JSON.stringify(s));
    else localStorage.removeItem(KEY);
  } catch {
    /* storage unavailable (private mode) — session lives in memory only */
  }
}

export class ApiError extends Error {
  constructor(message, status, code, fields) {
    super(message);
    this.status = status;
    this.code = code;
    this.fields = fields || {};
  }
}

let onLogout = () => {};
export function setLogoutHandler(fn) {
  onLogout = fn;
}

async function refresh(session) {
  const r = await fetch("/api/v1/auth/refresh", {
    method: "POST",
    headers: { Authorization: `Bearer ${session.refresh_token}` },
  });
  if (!r.ok) return null;
  const { access_token } = await r.json();
  const next = { ...session, access_token };
  saveSession(next);
  return next;
}

export async function api(path, { method = "GET", body, headers = {}, auth = true, retry = true } = {}) {
  const session = loadSession();
  const h = { ...headers };
  if (body !== undefined) h["Content-Type"] = "application/json";
  if (auth && session?.access_token) h.Authorization = `Bearer ${session.access_token}`;
  let res;
  try {
    res = await fetch(`/api/v1${path}`, { method, headers: h, body: body !== undefined ? JSON.stringify(body) : undefined });
  } catch {
    throw new ApiError("Can't reach the server. Check your connection and try again.", 0, "network");
  }
  if (res.status === 401 && auth && session?.refresh_token && retry) {
    const next = await refresh(session);
    if (next) return api(path, { method, body, headers, auth, retry: false });
    saveSession(null);
    onLogout();
  }
  const data = res.status === 204 ? null : await res.json().catch(() => null);
  if (!res.ok) {
    const e = data?.error || {};
    throw new ApiError(e.message || `Request failed (${res.status})`, res.status, e.code, e.fields);
  }
  return data;
}

export const qs = (params) => {
  const p = new URLSearchParams();
  Object.entries(params).forEach(([k, v]) => {
    if (v !== undefined && v !== null && v !== "" && v !== false) p.set(k, v);
  });
  const s = p.toString();
  return s ? `?${s}` : "";
};
