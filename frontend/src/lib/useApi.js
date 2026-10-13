import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "./api";

// GET a resource; refetch when `path` changes. Returns { data, error, loading, reload, setData }.
export function useApi(path, { interval } = {}) {
  const [state, setState] = useState({ data: null, error: null, loading: Boolean(path) });
  const alive = useRef(true);

  const load = useCallback(
    async (quiet = false) => {
      if (!path) return;
      if (!quiet) setState((s) => ({ ...s, loading: true, error: null }));
      try {
        const data = await api(path);
        if (alive.current) setState({ data, error: null, loading: false });
      } catch (error) {
        if (alive.current) setState((s) => ({ data: quiet ? s.data : null, error, loading: false }));
      }
    },
    [path]
  );

  useEffect(() => {
    alive.current = true;
    load();
    let t;
    if (interval) t = setInterval(() => document.visibilityState === "visible" && load(true), interval);
    return () => {
      alive.current = false;
      clearInterval(t);
    };
  }, [load, interval]);

  const setData = useCallback((fn) => setState((s) => ({ ...s, data: typeof fn === "function" ? fn(s.data) : fn })), []);
  return { ...state, reload: () => load(true), setData };
}
