import { useEffect, useId, useState } from "react";

// Keep incomplete typing local. A cleared field must not regenerate the site.
export default function NumberField({ label, value, min, max, step = 1, unit = "ft", onCommit }: {
  label: string; value: number; min: number; max: number; step?: number; unit?: string; onCommit: (value: number) => void;
}) {
  const [draft, setDraft] = useState(String(Number(value.toFixed(2))));
  const [error, setError] = useState("");
  const errorId = useId();
  useEffect(() => { setDraft(String(Number(value.toFixed(2)))); setError(""); }, [value]);
  function commit() {
    const n = Number(draft);
    if (!draft.trim() || !Number.isFinite(n) || n < min || n > max) {
      setError(`Enter ${min}–${max} ${unit}.`); return;
    }
    const rounded = Number((Math.round(n / step) * step).toFixed(4));
    setError(""); setDraft(String(rounded));
    if (rounded !== value) onCommit(rounded);
  }
  return <div className="number-control"><label className="field"><span>{label}<small>{unit}</small></span>
    <input type="number" aria-label={label} aria-invalid={!!error} aria-describedby={error ? errorId : undefined} value={draft} min={min} max={max} step={step}
      onChange={e => { setDraft(e.target.value); setError(""); }} onBlur={commit}
      onKeyDown={e => {
        if (e.key === "Enter") { e.preventDefault(); e.currentTarget.blur(); }
        if (e.key === "Escape") { setDraft(String(value)); setError(""); }
      }} /></label>{error && <p id={errorId} className="field-error" role="alert">{error}</p>}</div>;
}
