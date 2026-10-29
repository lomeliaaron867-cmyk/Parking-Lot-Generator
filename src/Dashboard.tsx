import { type Layout, type Settings } from "./solver";

export default function Dashboard({ s, r, ready, pending, onNavigate, onCompare, busy }: {
  s: Settings; r: Layout; ready: boolean; pending: boolean; busy: boolean;
  onNavigate: (tab: string) => void; onCompare: () => void;
}) {
  const paths = s.mode === "surface" && s.layoutMode === "paths";
  const count = r.stalls.length;
  return <div className="dashboard">
    <div className="panel-intro"><span className="step-label">3 / REVIEW THE RESULT</span><h2>Layout dashboard</h2><p>{s.mode === "garage" ? `Structured garage · ${s.levels} levels` : paths ? "Surface parking · curved aisles" : "Surface parking · automatic rows"}</p></div>
    {!ready ? <p className="note" role="status">{pending ? "Updating your layout. Results appear when the calculation finishes." : "Calculation unavailable. Use Retry in the viewport to restore results."}</p> : <>
      <section><h2>1. Dashboard view</h2>
        <div className="yield-summary"><div><strong>{count}</strong><span>parking spaces</span></div></div>
        <div className="mix-grid">{Object.entries(r.counts).map(([kind, n]) => <div key={kind}><b>{n}</b><span>{kind === "accessible" ? "Accessible*" : kind === "ev" ? "EV" : kind}</span></div>)}</div>
        <div className="readout"><span>Stalls per site acre</span><b>{r.area ? (count * 43560 / r.area).toFixed(1) : "—"}</b></div>
        <div className="readout"><span>Site area per stall</span><b>{count ? Math.round(r.area / count).toLocaleString() + " ft²" : "—"}</b></div>
        <p className="subtle">*Accessible designation is a layout allocation, not ADA certification. Garage density includes all levels.</p>
      </section>
      <section><h2>2. Parameters & access</h2>
        <p><b>Boundary:</b> {s.boundary.length} vertices; {s.setback} ft uniform parking setback on all edges. Independent front/rear/side setbacks are not yet supported.</p>
        <p><b>Massing:</b> {s.buildings.length} building footprints excluded from parking. Moving a building recalculates the available layout.</p>
        <p><b>Stalls:</b> {s.stallWidth} × {s.stallDepth} ft nominal at {s.angle}°. Compact: 8 × 16 ft. Accessible: {Math.max(9, s.stallWidth)} × {s.stallDepth} ft plus an 8 ft access aisle.</p>
        <p><b>Circulation:</b> {paths ? `${(s.paths ?? []).map(p => `${p.name}: ${p.width} ft`).join("; ") || "No paths drawn"}. Stalls follow each path tangent.` : `${s.aisle} ft aisles; ${s.orientation}° row orientation; ${s.entranceSide} entrance in the rotated layout frame.`}</p>
        <p><b>Access check:</b> {r.connected ? "Geometric boundary connection found." : "No verified boundary connection."} Turning radii are not automatically optimized.</p>
        <button className="wide" onClick={() => onNavigate("Review")}>Inspect warnings & turning study →</button>
      </section>
      <section><h2>3. Analysis & deliverables</h2>
        <p>Compare six configurations to test higher yields; this search does not prove a global optimum.</p>
        <button className="primary wide" disabled={busy} onClick={onCompare}>{busy ? "Comparing six layouts…" : "Calculate Scheme B options →"}</button>
        <p className="subtle">Alternative gains are measured by the solver, not estimated in advance.</p>
        <div className="readout"><span>Exports available</span><b>DXF · GLB · CSV · JSON</b></div>
        <p className="subtle">Native Revit (.rvt) and SketchUp (.skp) export are not supported.</p>
        <button className="wide" onClick={() => onNavigate("Files")}>Save or export this layout →</button>
      </section>
    </>}
  </div>;
}
