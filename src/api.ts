import { useEffect, useMemo, useState } from "react";
import { area, buildingPoly, type Settings, type Layout } from "./solver";

export type Option = { settings: Settings; layout: Layout; label?: string };
export async function requestPython<T>(route: string, settings: Settings, signal?: AbortSignal): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`/api/${route}`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ settings }), signal,
    });
  } catch (error) {
    if (signal?.aborted) throw error;
    throw new Error("Cannot reach the Python server. Start the backend, then choose Retry.");
  }
  if (!response.headers.get("content-type")?.includes("application/json"))
    throw new Error("Python API is unavailable. Run this app with its Python server, not GitHub Pages alone.");
  const data = await response.json();
  if (!response.ok) {
    const detail = Array.isArray(data.detail)
      ? data.detail.map((e: {field?: string; message?: string}) => `${e.field}: ${e.message}`).join("; ")
      : data.detail;
    throw new Error(detail || `Python server returned HTTP ${response.status}.`);
  }
  return data as T;
}

function emptyLayout(s: Settings): Layout {
  return {stalls: [], aisles: [], ramps: [], columns: [], loading: null, entrance: null,
    warnings: [], area: area(s.boundary), paved: 0, levelCount: s.mode === "garage" ? s.levels : 1,
    connected: false, buildingPolys: s.buildings.map(buildingPoly),
    counts: {standard: 0, accessible: 0, ev: 0, compact: 0}, rampLength: 0, floor: []};
}

export function usePythonLayout(s: Settings) {
  const key = useMemo(() => JSON.stringify(s), [s]);
  const [retry, setRetry] = useState(0);
  const [state, setState] = useState<{key: string; retry: number; layout?: Layout; error?: string}>({key: "", retry: -1});
  const empty = useMemo(() => emptyLayout(s), [s]);
  useEffect(() => {
    const controller = new AbortController();
    const timer = setTimeout(() => {
      requestPython<{layout: Layout}>("solve", s, controller.signal)
        .then(({layout}) => { if (!controller.signal.aborted) setState({key, retry, layout}); })
        .catch((error) => { if (!controller.signal.aborted) setState({key, retry, error: String(error.message || error)}); });
    }, 180);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [s, key, retry]);
  const current = state.key === key && state.retry === retry;
  const ready = current && !!state.layout;
  return {layout: ready ? state.layout! : empty, ready,
    error: current ? state.error : undefined,
    pending: !current || (!state.layout && !state.error),
    retry: () => setRetry((value) => value + 1)};
}
