import { useState, type FormEvent } from "react";
import { bounds, rectangle, type Settings } from "./solver";

export default function Brief({ settings: s, onApply, onContinue }: {
  settings: Settings; onApply: (settings: Settings) => void; onContinue: () => void;
}) {
  const box = bounds(s.boundary);
  const [width, setWidth] = useState(String(Math.round(box.maxX - box.minX)));
  const [depth, setDepth] = useState(String(Math.round(box.maxZ - box.minZ)));
  const [setback, setSetback] = useState(String(s.setback));
  const [mode, setMode] = useState(s.mode);
  const [building, setBuilding] = useState(false);
  const [bw, setBw] = useState("80"), [bd, setBd] = useState("50");
  const [error, setError] = useState("");
  const input = (label: string, value: string, set: (v: string) => void, min: number, max: number, unit: string) =>
    <label className="brief-field"><span>{label} <small>{unit}</small></span><input required type="number" aria-label={label} value={value} min={min} max={max} step="1" onChange={e => set(e.target.value)} /></label>;
  function submit(e: FormEvent) {
    e.preventDefault();
    if (building && (+bw + 2 * +setback >= +width || +bd + 2 * +setback >= +depth)) {
      setError("The building must fit inside the site setback. Reduce the footprint or enlarge the site."); return;
    }
    onApply({ ...s, boundary: rectangle(+width, +depth), mode, setback: +setback,
      buildings: building ? [{ id: "brief-building", w: +bw, d: +bd, height: 36, rotation: 0, x: 0, z: -+depth / 2 + +setback + +bd / 2 }] : [],
      layoutMode: "fill", paths: [], removed: [], loading: false, orientation: 0 });
  }
  return <div className="brief">
    <div className="panel-intro"><span className="step-label">1 / DEFINE YOUR SITE</span><h2>What are you planning?</h2><p>Choose your site dimensions and parking type. Then reshape the boundary or draw curved aisles.</p></div>
    <button className="wide continue-project" onClick={onContinue}>Continue with current site →</button>
    <p className="subtle">Your current layout stays in place until you apply a new brief.</p>
    <form onSubmit={submit}>
      <label className="brief-field"><span>Parking type</span><select aria-label="Parking type" value={mode} onChange={e => setMode(e.target.value as Settings["mode"])}><option value="surface">Surface parking</option><option value="garage">Structured garage</option></select></label>
      <div className="brief-grid">{input("Parcel width", width, setWidth, 80, 600, "ft")}{input("Parcel depth", depth, setDepth, 80, 600, "ft")}</div>
      {input("All-edge setback", setback, setSetback, 0, 40, "ft")}
      <label className="check"><input type="checkbox" checked={building} onChange={e => setBuilding(e.target.checked)} />Include a building footprint</label>
      {building && <><div className="brief-grid">{input("Footprint width", bw, setBw, 1, 300, "ft")}{input("Footprint depth", bd, setBd, 1, 300, "ft")}</div><p className="subtle">Placed at the north edge, inside the setback. Move it in Refine → Site & buildings.</p></>}
      <p className="note">Creates a rectangular site and replaces existing buildings, paths and manual removals. Undo restores them.</p>
      {error && <p role="alert" className="field-error">{error}</p>}
      <button className="primary wide" type="submit">Apply brief & generate parking →</button>
    </form>
  </div>;
}
