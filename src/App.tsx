import Brief from "./Brief";
import Dashboard from "./Dashboard";
import NumberField from "./NumberField";
import { requestPython, usePythonLayout } from "./api";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Scene, { type EditorTool, type ViewOptions } from "./Scene";
import {
  defaults,
  clone,
  rectangle,
  validBoundary,
  validateProject,
  bounds,
  type Settings,
  type Point,
  type Building,
  type Layout,
} from "./solver";
import { defaultTurn, turningStudy, type Turn } from "./turning";
import { exportJSON, exportCSV, exportDXF } from "./exports";
import {
  roundedSite,
  ellipseSite,
  curvePreset,
  type DrivePath,
} from "./curves";
type Option = { settings: Settings; layout: Layout; label?: string };
type Scheme = { name: string; settings: Settings };
const STORAGE = "parking-studio-python-v1";
function initial() {
  try {
    const value = localStorage.getItem(STORAGE);
    return value ? validateProject(JSON.parse(value)) : clone(defaults);
  } catch {
    return clone(defaults);
  }
}
function loadSchemes(): Scheme[] {
  try {
    const a = JSON.parse(localStorage.getItem(STORAGE + "-schemes") || "[]");
    return Array.isArray(a)
      ? a.slice(0, 20).map((v) => ({
          name: String(v.name).slice(0, 80),
          settings: validateProject(v),
        }))
      : [];
  } catch {
    return [];
  }
}
export default function App() {
  const [s, setS] = useState<Settings>(initial),
    [past, setPast] = useState<Settings[]>([]),
    [future, setFuture] = useState<Settings[]>([]),
    [tab, setTab] = useState("Brief");
  const [top, setTop] = useState(true),
    [navigation, setNavigation] = useState<"orbit" | "pan">("orbit"),
    [zoom, setZoom] = useState<{id:number; direction:"in"|"out"}>({id:0,direction:"in"}),
    [cars, setCars] = useState(true),
    [dimensions, setDimensions] = useState(false),
    [explode, setExplode] = useState(0),
    [section, setSection] = useState(false),
    [level, setLevel] = useState(-1),
    [tool, setTool] = useState<EditorTool>("orbit"),
    [selected, setSelected] = useState(s.buildings[0]?.id ?? ""),
    [draft, setDraft] = useState<Point[]>([]),
    [selectedPath, setSelectedPath] = useState(s.paths?.[0]?.id ?? ""),
    [fit, setFit] = useState(0),
    [turn, setTurn] = useState<Turn>(defaultTurn);
  const [notice, setNotice] = useState(""),
    [showControls, setShowControls] = useState(false),
    [options, setOptions] = useState<Option[]>([]),
    [busy, setBusy] = useState(false),
    [schemes, setSchemes] = useState<Scheme[]>(loadSchemes),
    [name, setName] = useState("Scheme 01");
  const glb = useRef<(() => Promise<void>) | null>(null),
    controlsBar = useRef<HTMLDivElement>(null),
    sidebar = useRef<HTMLElement>(null),
    file = useRef<HTMLInputElement>(null),
    worker = useRef<AbortController | null>(null),
    current = useRef(s);
  current.current = s;
  const python = usePythonLayout(s);
  const r = python.layout,
    box = bounds(s.boundary),
    building = s.buildings.find((b) => b.id === selected),
    study = useMemo(
      () => (turn.enabled ? turningStudy(s, r, turn) : null),
      [s, r, turn],
    );
  const v: ViewOptions = useMemo(
    () => ({
      top,
      navigation,
      zoom,
      cars,
      dimensions,
      explode,
      section,
      level,
      tool,
      selected,
      draft,
      selectedPath,
      fit,
      turn,
    }),
    [
      top,
      navigation,
      zoom,
      cars,
      dimensions,
      explode,
      section,
      level,
      tool,
      selected,
      draft,
      selectedPath,
      fit,
      turn,
    ],
  );
  const commit = useCallback((next: Settings) => {
    setPast((p) => [...p.slice(-59), clone(current.current)]);
    setFuture([]);
    setS(next);
    setOptions([]);
  }, []);
  const patch = (values: Partial<Settings>) => commit({ ...s, ...values });
  const undo = useCallback(() => {
    if (!past.length) return;
    setFuture((f) => [clone(s), ...f]);
    setS(past[past.length - 1]);
    setPast((p) => p.slice(0, -1));
    setOptions([]);
  }, [past, s]);
  const redo = useCallback(() => {
    if (!future.length) return;
    setPast((p) => [...p, clone(s)]);
    setS(future[0]);
    setFuture((f) => f.slice(1));
    setOptions([]);
  }, [future, s]);
  useEffect(() => {
    try {
      localStorage.setItem(
        STORAGE,
        JSON.stringify({ version: 2, settings: s }),
      );
    } catch {
      setNotice(
        "Browser storage is unavailable. Export a project file to keep your work.",
      );
    }
  }, [s]);
  useEffect(() => {
    if (!notice) return;
    const id = setTimeout(() => setNotice(""), 6500);
    return () => clearTimeout(id);
  }, [notice]);
  useEffect(() => {
    const listener = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).matches("input,textarea,select")) return;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") {
        e.preventDefault();
        e.shiftKey ? redo() : undo();
      }
      if (e.key === "Escape") {
        setTool("orbit");
        setDraft([]);
        setShowControls(false);
      }
      if (!e.ctrlKey && !e.metaKey && !e.altKey && e.key.toLowerCase() === "f") {
        e.preventDefault();
        setFit((n) => n + 1);
      }
    };
    window.addEventListener("keydown", listener);
    return () => window.removeEventListener("keydown", listener);
  }, [undo, redo]);
  useEffect(() => () => worker.current?.abort(), []);
  useEffect(() => { sidebar.current?.scrollTo({top:0}); }, [tab,tool]);
  useEffect(() => {
    const bar = controlsBar.current;
    if (!bar) return;
    const update = () => bar.parentElement?.style.setProperty("--scene-top", `${bar.offsetTop + bar.offsetHeight + 16}px`);
    const observer = new ResizeObserver(update);
    observer.observe(bar); update();
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    if (!(s.paths ?? []).some((p) => p.id === selectedPath))
      setSelectedPath(s.paths?.[0]?.id ?? "");
  }, [s.paths, selectedPath]);
  useEffect(() => {
    if (level >= r.levelCount) setLevel(-1);
  }, [level, r.levelCount]);
  const exportReady = useCallback((fn: () => Promise<void>) => {
    glb.current = fn;
  }, []);
  const updateBuilding = (values: Partial<Building>) =>
    patch({
      buildings: s.buildings.map((b) =>
        b.id === selected ? { ...b, ...values } : b,
      ),
    });
  function selectTool(t: EditorTool) {
    if (t === "building" && !s.buildings.length) {
      setTab("Site"); setNotice("Add a building before using Move building."); return;
    }
    if (t === "edit-path" && !(s.paths?.length)) {
      setTab("Paths"); setNotice("Draw an aisle first, then edit its blue control points."); return;
    }
    if (t === "draw-path" && (s.paths?.length ?? 0) >= 12) {
      setNotice(
        "A project supports up to 12 aisles. Edit or delete an existing one first.",
      );
      return;
    }
    setTool(t);
    if (["boundary", "draw", "building"].includes(t)) setTab("Site");
    if (t === "erase") setTab("Parking");
    if (["boundary", "draw", "erase", "draw-path", "edit-path"].includes(t))
      setTop(true);
    if (t === "draw" || t === "draw-path") setDraft([]);
    if (t !== "draw" && t !== "draw-path") setDraft([]);
    if (t === "draw-path" || t === "edit-path") {
      setTab("Paths");
      if (
        t === "edit-path" &&
        (s.mode !== "surface" || s.layoutMode !== "paths")
      )
        patch({ mode: "surface", layoutMode: "paths" });
      setLevel(-1);
      if (!selectedPath) setSelectedPath(s.paths?.[0]?.id ?? "");
    }
  }
  function onMove(type: string, id: string, p: Point) {
    if (type === "path-node") {
      const [pathId, index] = JSON.parse(id) as [string, number];
      setSelectedPath(pathId);
      patch({
        paths: (s.paths ?? []).map((path) =>
          path.id === pathId
            ? {
                ...path,
                points: path.points.map((q, i) =>
                  i === index
                    ? {
                        x: Math.max(-1000, Math.min(1000, p.x)),
                        z: Math.max(-1000, Math.min(1000, p.z)),
                      }
                    : q,
                ),
              }
            : path,
        ),
        removed: [],
      });
    } else if (type === "vertex") {
      const boundary = s.boundary.map((q, i) => (i === +id ? p : q));
      if (validBoundary(boundary)) patch({ boundary, removed: [] });
      else
        setNotice(
          "That boundary crosses itself or is too small. The previous shape was kept.",
        );
    } else
      patch({
        buildings: s.buildings.map((b) =>
          b.id === id
            ? {
                ...b,
                x: Math.max(-1000, Math.min(1000, p.x)),
                z: Math.max(-1000, Math.min(1000, p.z)),
              }
            : b,
        ),
      });
  }
  function numeric(
    label: string,
    value: number,
    min: number,
    max: number,
    change: (n: number) => void,
    unit = "ft",
    step = 1,
  ) {
    return <NumberField label={label} value={value} min={min} max={max} step={step} unit={unit} onCommit={change} />;
  }

  const control = (
    key: keyof Settings,
    label: string,
    min: number,
    max: number,
    unit = "ft",
    step = 1,
  ) =>
    numeric(
      label,
      Number(s[key]),
      min,
      max,
      (n) => patch({ [key]: n }),
      unit,
      step,
    );
  function resizeSite(axis: "x" | "z", value: number) {
    const min = axis === "x" ? box.minX : box.minZ,
      max = axis === "x" ? box.maxX : box.maxZ,
      center = (min + max) / 2;
    patch({
      boundary: s.boundary.map((p) => ({
        ...p,
        [axis]: center + ((p[axis] - center) * value) / (max - min),
      })),
      removed: [],
    });
  }
  async function generate() {
    worker.current?.abort();
    const controller = new AbortController();
    worker.current = controller;
    setBusy(true);
    const snapshot = JSON.stringify(s);
    try {
      const {options} = await requestPython<{options: Option[]}>("alternatives", s, controller.signal);
      if (controller.signal.aborted) return;
      if (JSON.stringify(current.current) !== snapshot) {
        setNotice("Settings changed. Generate alternatives again for the updated site.");
        return;
      }
      setOptions(options);
      setTab("Compare");
    } catch (error) {
      if (!controller.signal.aborted) setNotice(error instanceof Error ? error.message : String(error));
    } finally {
      if (worker.current === controller) setBusy(false);
    }
  }
  function saveScheme() {
    if (!name.trim()) {
      setNotice("Give the scheme a name first.");
      return;
    }
    const next = [
      ...schemes.filter((p) => p.name !== name),
      { name: name.trim().slice(0, 80), settings: clone(s) },
    ].slice(-20);
    try {
      localStorage.setItem(STORAGE + "-schemes", JSON.stringify(next));
      setSchemes(next);
      setNotice("Scheme saved in this browser.");
    } catch {
      setNotice("Could not save in this browser. Export JSON instead.");
    }
  }
  async function importFile(f: File) {
    try {
      if (f.size > 2_000_000)
        throw new Error("Project file is too large (2 MB maximum).");
      const next = validateProject(JSON.parse(await f.text()));
      commit(next);
      setSelected(next.buildings[0]?.id ?? "");
      setLevel(-1);
      setNotice("Project imported.");
      setSelectedPath(next.paths?.[0]?.id ?? "");
      setFit((n) => n + 1);
    } catch (e) {
      setNotice(e instanceof Error ? e.message : "Invalid project file.");
    }
  }
  function garagePreset() {
    commit({
      ...s,
      boundary: rectangle(280, 260),
      buildings: [],
      mode: "garage",
      layoutMode: "fill",
      orientation: 0,
      loading: false,
      removed: [],
    });
    setLevel(-1);
    setTab("Garage");
    setTop(false);
  }
  const labels: Record<EditorTool, string> = {
    orbit: "Explore",
    boundary: "Edit boundary",
    draw: "Draw site",
    building: "Move building",
    erase: "Remove stalls",
    "draw-path": "Draw aisle",
    "edit-path": "Edit curve",
  };
  const activePath = (s.paths ?? []).find((p) => p.id === selectedPath);
  function updatePath(values: Partial<DrivePath>) {
    patch({
      paths: (s.paths ?? []).map((p) =>
        p.id === selectedPath ? { ...p, ...values } : p,
      ),
      removed: [],
    });
  }
  function loadCurve(kind: "sweep" | "loop") {
    const preset = curvePreset(kind);
    commit({
      ...s,
      ...preset,
      mode: "surface",
      layoutMode: "paths",
      buildings: [],
      loading: false,
      removed: [],
    });
    setSelectedPath(preset.paths[0].id);
    setTab("Paths");
    setTool("edit-path");
    setTop(true);
    setLevel(-1);
    setFit((n) => n + 1);
  }
  return (
    <div className="app">
      <header>
        <div className="brand">
          <span className="logo">P</span>PARKING
          <span className="thin">STUDIO</span>
          <span className="badge">PARKING FEASIBILITY</span>
        </div>
        <div className="header-actions">
          <button aria-label="Undo" disabled={!past.length} onClick={undo}>
            ↶ Undo
          </button>
          <button aria-label="Redo" disabled={!future.length} onClick={redo}>
            ↷ Redo
          </button>
          <button onClick={() => setShowControls(value => !value)}>Help</button>
          <button onClick={() => setTab("Files")}>Save / export</button>
        </div>
      </header>
      <div className="workspace">
        <aside ref={sidebar}>
          <nav className="workflow" aria-label="Project workflow">
            <button className={tab === "Brief" ? "active" : ""} aria-current={tab === "Brief" ? "step" : undefined} onClick={() => { setTab("Brief"); selectTool("orbit"); }}><b>1</b>Start</button>
            <button className={["Site", "Paths", "Parking", "Garage"].includes(tab) ? "active" : ""} onClick={() => setTab("Site")}><b>2</b>Refine</button>
            <button className={["Dashboard", "Compare", "Review", "Files"].includes(tab) ? "active" : ""} onClick={() => { setTab("Dashboard"); selectTool("orbit"); }}><b>3</b>Results</button>
          </nav>
          <div className="project-caption"><strong>{name}</strong><span>{s.mode === "garage" ? "Structured garage" : "Surface parking"}</span></div>
          {tab !== "Brief" && <nav className="panel-tabs compact-tabs" aria-label="Editor panels">
            {(["Site", "Paths", "Parking", "Garage"].includes(tab)
              ? ["Site", "Paths", "Parking", "Garage"] : ["Dashboard", "Compare", "Review", "Files"]).map(t =>
              <button key={t} className={tab === t ? "active" : ""} aria-current={tab === t ? "page" : undefined} onClick={() => setTab(t)}>
                {({Site: "Site & buildings", Paths: "Curved aisles", Parking: "Stall settings", Garage: "Garage", Dashboard: "Dashboard", Compare: "Compare", Review: "Checks", Files: "Save & export"} as Record<string,string>)[t]}
              </button>)}
          </nav>}
          {tab === "Brief" && <Brief settings={s} onContinue={() => setTab("Site")} onApply={next => {
            commit(next); setSelected(next.buildings[0]?.id ?? ""); setSelectedPath(""); setLevel(-1);
            selectTool("orbit"); setTop(true); setFit(n => n + 1); setTab("Dashboard");
            setNotice("Site brief applied. Your parking layout is being calculated.");
          }} />}
          {tab === "Dashboard" && <Dashboard s={s} r={r} ready={python.ready} pending={python.pending} busy={busy} onNavigate={setTab} onCompare={generate} />}
          {tool === "orbit" && ["Site", "Paths", "Parking", "Garage"].includes(tab) && <div className="refine-hint"><b>Refine your layout</b><p>Type a value, then press Enter. To edit the drawing, choose a named tool above the plan. Changes can be undone.</p><button className="wide" onClick={() => { setTab("Dashboard"); selectTool("orbit"); }}>Review layout results →</button></div>}
          {tab === "Garage" && <div className="mode-switch"><button className={s.mode === "surface" ? "active" : ""} onClick={() => patch({mode:"surface"})}>Surface parking</button><button className={s.mode === "garage" ? "active" : ""} onClick={() => { patch({mode:"garage",layoutMode:"fill"}); setLevel(-1); }}>Structured garage</button></div>}
          <div className="sidebar-tool">
          {tool !== "orbit" && tool !== "draw" && tool !== "draw-path" && (
            <div className="editing-card" role="status">
              <div><b>{labels[tool]}</b><span>{tool === "edit-path" ? ((s.paths?.length ?? 0) ? "Drag a blue point to reshape the selected aisle." : "Choose Draw aisle to place your first path.") : tool === "boundary" ? "Drag a blue corner. Parking updates when you release." : tool === "building" ? (s.buildings.length ? "Drag a building. Resize it in the Site panel." : "Add a building in the Site panel to get started.") : "Click a parking space to remove it. Undo restores it."}</span></div>
              <button onClick={() => selectTool("orbit")}>Done editing <kbd>Esc</kbd></button>
            </div>
          )}
          {(tool === "draw" || tool === "draw-path") && (
            <div className="draw-card">
              <b>
                {draft.length} {tool === "draw-path" ? "aisle" : "boundary"}{" "}
                points
              </b>
              <span>
                {tool === "draw-path"
                  ? "Click the aisle control points. Begin or end at the site edge for access."
                  : "Click around the new site. Finish closes the polygon."}
              </span>
              <button
                className="primary"
                disabled={draft.length < (tool === "draw-path" ? 2 : 3)}
                onClick={() => {
                  if (tool === "draw-path") {
                    const path: DrivePath = {
                      id: crypto.randomUUID(),
                      name: `Aisle ${(s.paths?.length ?? 0) + 1}`,
                      points: draft,
                      smooth: true,
                      closed: false,
                      width: s.aisle,
                      parking: "both",
                    };
                    patch({
                      paths: [...(s.paths ?? []), path],
                      mode: "surface",
                      layoutMode: "paths",
                      removed: [],
                    });
                    setSelectedPath(path.id);
                    setDraft([]);
                    setTool("edit-path");
                  } else if (validBoundary(draft)) {
                    patch({ boundary: draft, removed: [] });
                    setDraft([]);
                    setTool("orbit");
                  } else
                    setNotice(
                      "Draw a non-crossing polygon with at least 500 sq ft.",
                    );
                }}
              >
                {tool === "draw-path" ? "Finish aisle" : "Finish boundary"}
              </button>
              <button disabled={!draft.length} onClick={() => setDraft((points) => points.slice(0, -1))}>
                Undo last point
              </button>
              <button
                onClick={() => {
                  setDraft([]);
                  setTool("orbit");
                }}
              >
                Cancel
              </button>
            </div>
          )}
          </div>
          {tab === "Site" && (
            <>
              <section>
                <h2>
                  Site envelope <span>{s.boundary.length} vertices</span>
                </h2>
                {numeric("Site width", box.maxX - box.minX, 80, 600, (n) =>
                  resizeSite("x", n),
                )}
                {numeric("Site depth", box.maxZ - box.minZ, 80, 600, (n) =>
                  resizeSite("z", n),
                )}
                {control("setback", "Edge setback", 1, 40)}
                <div className="button-grid">
                  <button onClick={() => selectTool("draw")}>
                    Draw new site
                  </button>
                  <button onClick={() => selectTool("boundary")}>
                    Move vertices
                  </button>
                  <button
                    onClick={() =>
                      patch({ boundary: rectangle(260, 240), removed: [] })
                    }
                  >
                    Rectangle
                  </button>
                  <button
                    onClick={() =>
                      patch({
                        boundary: [
                          { x: -130, z: -120 },
                          { x: 100, z: -120 },
                          { x: 130, z: -40 },
                          { x: 85, z: 120 },
                          { x: -130, z: 120 },
                        ],
                        removed: [],
                      })
                    }
                  >
                    Irregular example
                  </button>
                  <button
                    onClick={() => {
                      patch({ boundary: roundedSite(), removed: [] });
                      setFit((n) => n + 1);
                    }}
                  >
                    Rounded corners
                  </button>
                  <button
                    onClick={() => {
                      patch({ boundary: ellipseSite(), removed: [] });
                      setFit((n) => n + 1);
                    }}
                  >
                    Ellipse
                  </button>
                  <button
                    onClick={() => {
                      patch({
                        boundary: [
                          { x: -150, z: -130 },
                          { x: 150, z: -130 },
                          { x: 150, z: -30 },
                          { x: 30, z: -30 },
                          { x: 30, z: 130 },
                          { x: -150, z: 130 },
                        ],
                        removed: [],
                      });
                      setFit((n) => n + 1);
                    }}
                  >
                    L-shaped site
                  </button>
                  <button
                    disabled={s.boundary.length > 30}
                    onClick={() => {
                      const boundary = s.boundary.flatMap((p, i) => {
                        const q = s.boundary[(i + 1) % s.boundary.length];
                        return [
                          {
                            x: p.x * 0.8 + q.x * 0.2,
                            z: p.z * 0.8 + q.z * 0.2,
                          },
                          {
                            x: p.x * 0.2 + q.x * 0.8,
                            z: p.z * 0.2 + q.z * 0.8,
                          },
                        ];
                      });
                      if (validBoundary(boundary))
                        patch({ boundary, removed: [] });
                    }}
                  >
                    Soften corners
                  </button>
                </div>
                <details>
                  <summary>Vertex coordinates</summary>
                  {s.boundary.map((p, i) => (
                    <div className="vertex-row" key={i}>
                      <span>{i + 1}</span>
                      {(["x", "z"] as const).map((axis) => (
                        <input
                          key={axis}
                          type="number"
                          aria-label={`Vertex ${i + 1} ${axis}`}
                          value={p[axis]}
                          onChange={(e) => {
                            const n = e.target.valueAsNumber;
                            if (!Number.isFinite(n)) return;
                            const boundary = s.boundary.map((q, j) =>
                              j === i ? { ...q, [axis]: n } : q,
                            );
                            if (validBoundary(boundary)) patch({ boundary });
                          }}
                        />
                      ))}
                      <button
                        aria-label={`Insert vertex after ${i + 1}`}
                        onClick={() => {
                          const q = s.boundary[(i + 1) % s.boundary.length];
                          const boundary = [...s.boundary];
                          boundary.splice(i + 1, 0, {
                            x: (p.x + q.x) / 2,
                            z: (p.z + q.z) / 2,
                          });
                          if (boundary.length <= 60) patch({ boundary });
                        }}
                      >
                        +
                      </button>
                      <button
                        aria-label={`Delete vertex ${i + 1}`}
                        disabled={s.boundary.length <= 3}
                        onClick={() => {
                          const boundary = s.boundary.filter((_, j) => j !== i);
                          if (validBoundary(boundary)) patch({ boundary });
                        }}
                      >
                        ×
                      </button>
                    </div>
                  ))}
                </details>
              </section>
              <section>
                <h2>
                  Building massing <span>{s.buildings.length} buildings</span>
                </h2>
                <select
                  aria-label="Selected building"
                  value={selected}
                  onChange={(e) => setSelected(e.target.value)}
                >
                  <option value="">Select building</option>
                  {s.buildings.map((b, i) => (
                    <option key={b.id} value={b.id}>
                      Building {i + 1}
                    </option>
                  ))}
                </select>
                <button
                  className="wide"
                  disabled={s.buildings.length >= 12}
                  onClick={() => {
                    const b = {
                      id: crypto.randomUUID(),
                      x: 0,
                      z: 0,
                      w: 60,
                      d: 40,
                      height: 30,
                      rotation: 0,
                    };
                    patch({ buildings: [...s.buildings, b] });
                    setSelected(b.id);
                    selectTool("building");
                  }}
                >
                  + Add building
                </button>
                {building && (
                  <>
                    {numeric("Building width", building.w, 10, 200, (n) =>
                      updateBuilding({ w: n }),
                    )}
                    {numeric("Building depth", building.d, 10, 200, (n) =>
                      updateBuilding({ d: n }),
                    )}
                    {numeric("Building height", building.height, 10, 200, (n) =>
                      updateBuilding({ height: n }),
                    )}
                    {numeric(
                      "Building rotation",
                      building.rotation,
                      0,
                      360,
                      (n) => updateBuilding({ rotation: n }),
                      "°",
                      5,
                    )}
                    {numeric("Building X", building.x, -500, 500, (n) =>
                      updateBuilding({ x: n }),
                    )}
                    {numeric("Building Z", building.z, -500, 500, (n) =>
                      updateBuilding({ z: n }),
                    )}
                    <div className="button-grid">
                      <button onClick={() => selectTool("building")}>
                        Drag in scene
                      </button>
                      <button
                        onClick={() => {
                          patch({
                            buildings: s.buildings.filter(
                              (b) => b.id !== selected,
                            ),
                          });
                          setSelected("");
                        }}
                      >
                        Delete building
                      </button>
                    </div>
                  </>
                )}
              </section>
              <section>
                <h2>Terrain</h2>
                {control("slopeX", "East–west slope", -10, 10, "%", 0.5)}
                {control("slopeZ", "North–south slope", -10, 10, "%", 0.5)}
                <p className="note">
                  A single sloped terrain plane. Garage decks remain level;
                  grading volumes are not calculated.
                </p>
              </section>
            </>
          )}
          {tab === "Paths" && (
            <>
              <section>
                <h2>Circulation layout</h2>
                <div className="mode-switch">
                  <button
                    className={s.layoutMode !== "paths" ? "active" : ""}
                    onClick={() => patch({ layoutMode: "fill" })}
                  >
                    Automatic rows
                  </button>
                  <button
                    className={s.layoutMode === "paths" ? "active" : ""}
                    onClick={() => {
                      patch({ layoutMode: "paths", mode: "surface" });
                      setLevel(-1);
                    }}
                  >
                    Custom aisles
                  </button>
                </div>
                <p className="note">
                  Draw a drive aisle through the site, then drag its blue
                  control points. Connect at least one endpoint to the site
                  edge. Curved aisles apply to surface parking.
                </p>
                <div className="button-grid">
                  <button onClick={() => loadCurve("sweep")}>
                    Sweeping drive example
                  </button>
                  <button onClick={() => loadCurve("loop")}>
                    Loop + entry example
                  </button>
                </div>
                <p className="subtle">
                  Examples replace the boundary and buildings. Undo restores
                  your design.
                </p>
              </section>
              <section>
                <h2>
                  Drive aisles <span>{s.paths?.length ?? 0} paths</span>
                </h2>
                <select
                  aria-label="Selected drive aisle"
                  value={selectedPath}
                  onChange={(e) => setSelectedPath(e.target.value)}
                >
                  <option value="">Select an aisle</option>
                  {(s.paths ?? []).map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
                <div className="button-grid">
                  <button
                    disabled={(s.paths?.length ?? 0) >= 12}
                    onClick={() => selectTool("draw-path")}
                  >
                    + Draw aisle
                  </button>
                  <button
                    disabled={!activePath}
                    onClick={() => selectTool("edit-path")}
                  >
                    Move curve points
                  </button>
                </div>
                {activePath && (
                  <>
                    <label className="field">
                      <span>Name</span>
                      <input
                        aria-label="Aisle name"
                        maxLength={80}
                        value={activePath.name}
                        onChange={(e) => updatePath({ name: e.target.value })}
                      />
                    </label>
                    {numeric("Aisle width", activePath.width, 16, 36, (n) =>
                      updatePath({ width: n }),
                    )}
                    <label className="field">
                      <span>Parking sides</span>
                      <select
                        value={activePath.parking}
                        onChange={(e) =>
                          updatePath({
                            parking: e.target.value as DrivePath["parking"],
                          })
                        }
                      >
                        <option value="both">Both sides</option>
                        <option value="left">Left side</option>
                        <option value="right">Right side</option>
                        <option value="none">Drive only</option>
                      </select>
                    </label>
                    <label className="check">
                      <input
                        type="checkbox"
                        checked={activePath.smooth}
                        onChange={(e) =>
                          updatePath({ smooth: e.target.checked })
                        }
                      />{" "}
                      Smooth curve
                    </label>
                    <label className="check">
                      <input
                        type="checkbox"
                        disabled={activePath.points.length < 3}
                        checked={activePath.closed}
                        onChange={(e) =>
                          updatePath({ closed: e.target.checked })
                        }
                      />{" "}
                      Closed loop
                    </label>
                    <details>
                      <summary>Control-point coordinates</summary>
                      {activePath.points.map((p, i) => (
                        <div className="vertex-row" key={i}>
                          <span>{i + 1}</span>
                          {(["x", "z"] as const).map((axis) => (
                            <input
                              key={axis}
                              type="number"
                              aria-label={`Curve point ${i + 1} ${axis}`}
                              value={Number(p[axis].toFixed(1))}
                              onChange={(e) => {
                                const n = e.target.valueAsNumber;
                                if (Number.isFinite(n) && Math.abs(n) <= 1000)
                                  updatePath({
                                    points: activePath.points.map((q, j) =>
                                      j === i ? { ...q, [axis]: n } : q,
                                    ),
                                  });
                              }}
                            />
                          ))}
                          <button
                            aria-label={`Insert curve point after ${i + 1}`}
                            disabled={activePath.points.length >= 40}
                            onClick={() => {
                              const q =
                                  activePath.points[
                                    (i + 1) % activePath.points.length
                                  ],
                                points = [...activePath.points];
                              points.splice(i + 1, 0, {
                                x: (p.x + q.x) / 2,
                                z: (p.z + q.z) / 2,
                              });
                              updatePath({ points });
                            }}
                          >
                            +
                          </button>
                          <button
                            aria-label={`Delete curve point ${i + 1}`}
                            disabled={
                              activePath.points.length <=
                              (activePath.closed ? 3 : 2)
                            }
                            onClick={() =>
                              updatePath({
                                points: activePath.points.filter(
                                  (_, j) => j !== i,
                                ),
                              })
                            }
                          >
                            ×
                          </button>
                        </div>
                      ))}
                    </details>
                    <button
                      className="wide"
                      onClick={() => {
                        patch({
                          paths: (s.paths ?? []).filter(
                            (p) => p.id !== selectedPath,
                          ),
                          removed: [],
                        });
                        setSelectedPath("");
                      }}
                    >
                      Delete selected aisle
                    </button>
                  </>
                )}
              </section>
              <section>
                <h2>Curve design notes</h2>
                <p className="note">
                  Stalls follow the aisle tangent and are omitted where they
                  collide or cross setbacks. Intersecting road sections connect
                  geometrically. Use Review for a vehicle-turning study; curve
                  geometry does not certify maneuverability.
                </p>
              </section>
            </>
          )}
          {tab === "Parking" && (
            <>
              <section>
                <h2>Parking geometry</h2>
                {control("stallWidth", "Stall width", 8, 14)}
                {control("stallDepth", "Stall depth", 16, 24)}
                {s.layoutMode !== "paths" &&
                  control("aisle", "Drive aisle", 20, 36)}
                <label className="field">
                  <span>Parking angle</span>
                  <select
                    value={s.angle}
                    onChange={(e) =>
                      patch({ angle: +e.target.value, removed: [] })
                    }
                  >
                    {[90, 60, 45].map((a) => (
                      <option key={a} value={a}>
                        {a}°
                      </option>
                    ))}
                  </select>
                </label>
                {s.layoutMode === "paths" ? (
                  <p className="note">
                    Aisle geometry and widths are controlled in Access + curved
                    aisles. Stall angle and parking mix apply along those
                    curves.
                  </p>
                ) : (
                  control("orientation", "Row orientation", 0, 180, "°", 5)
                )}
                <label className="field" hidden={s.layoutMode === "paths"}>
                  <span>Entrance edge*</span>
                  <select
                    value={s.entranceSide}
                    onChange={(e) =>
                      patch({
                        entranceSide: e.target
                          .value as Settings["entranceSide"],
                      })
                    }
                  >
                    <option value="south">South</option>
                    <option value="north">North</option>
                  </select>
                </label>
                <p className="note" hidden={s.layoutMode === "paths"}>
                  *Relative to the rotated row grid. Green pavement marks the
                  boundary entrance.
                </p>
              </section>
              <section>
                <h2>Parking mix</h2>
                {control(
                  "accessible",
                  "Accessible target per level",
                  0,
                  30,
                  "spaces",
                )}
                {control("evPercent", "EV allocation preference", 0, 80, "%")}
                {control(
                  "compactPercent",
                  "Compact allocation preference",
                  0,
                  80,
                  "%",
                )}
                <p className="note">
                  Accessible stalls reserve an 8 ft access aisle. Compact stalls
                  use up to 8 × 16 ft. Actual mix is reported below; percentages
                  are allocation preferences.
                </p>
                <label className="check">
                  <input
                    type="checkbox"
                    checked={s.loading}
                    onChange={(e) => patch({ loading: e.target.checked })}
                  />{" "}
                  Reserve a 14 × 40 ft loading zone
                </label>
                {s.loading && (
                  <>
                    {control("loadingX", "Loading X", -500, 500)}
                    {control("loadingZ", "Loading Z", -500, 500)}
                  </>
                )}
              </section>
              <section>
                <h2>Manual overrides</h2>
                <button className="wide" onClick={() => selectTool("erase")}>
                  Click stalls to remove
                </button>
                <button
                  className="wide"
                  disabled={!s.removed.length}
                  onClick={() => patch({ removed: [] })}
                >
                  Restore {s.removed.length} removed positions
                </button>
                <p className="note">
                  Removed garage positions apply to every level. Geometry
                  changes may relocate generated positions.
                </p>
              </section>
            </>
          )}
          {tab === "Garage" && (
            <>
              <section>
                <h2>Garage configuration</h2>
                <button className="primary wide" onClick={garagePreset}>
                  Load a garage-ready site
                </button>
                <p className="note">
                  This preset creates a 280 × 260 ft rectangular site and
                  removes buildings and loading exclusions. Undo restores your
                  previous design.
                </p>
                {control("levels", "Parking levels", 1, 8, "levels")}
                {control("floorHeight", "Floor-to-floor height", 9, 16)}
                {control("rampSlope", "Ramp slope", 5, 15, "%")}
                <div className="readout">
                  <span>Ramp run</span>
                  <b>{r.rampLength.toFixed(1)} ft</b>
                </div>
                <p className="note">
                  Straight ramps reserve space on each floor, with cross-aisle
                  landings at both ends. Columns are illustrative and placed
                  only in unused areas.
                </p>
              </section>
              <section>
                <h2>Inspect the structure</h2>
                {numeric("Exploded floor spacing", explode, 0, 40, setExplode)}
                <label className="field">
                  <span>Visible level</span>
                  <select
                    value={level}
                    onChange={(e) => setLevel(+e.target.value)}
                  >
                    <option value={-1}>All levels</option>
                    {Array.from({ length: r.levelCount }, (_, i) => (
                      <option key={i} value={i}>
                        Level {i + 1}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="check">
                  <input
                    type="checkbox"
                    checked={section}
                    onChange={(e) => setSection(e.target.checked)}
                  />{" "}
                  Section cut through site center
                </label>
                <p className="note">
                  Exploded spacing and section cuts are viewing tools. Return to
                  assembled view before exporting a 3D presentation.
                </p>
              </section>
            </>
          )}
          {tab === "Compare" && (
            <>
              <section>
                <h2>Explore alternatives</h2>
                <p className="note">
                  {s.layoutMode === "paths"
                    ? "Compare parking angles and aisle widths along your curves."
                    : "Compare six combinations of row direction and parking angle."}{" "}
                  Counts include the requested levels and exclusions.
                </p>
                <button
                  className="primary wide"
                  disabled={busy || !python.ready}
                  onClick={generate}
                >
                  {busy ? "Generating…" : "Generate six alternatives"}
                </button>
                {options.map((o, i) => (
                  <button
                    key={i}
                    className="option-card"
                    onClick={() => {
                      commit(o.settings);
                      setNotice(
                        "Layout applied. Undo returns to the previous scheme.",
                      );
                    }}
                  >
                    <span>
                      OPTION {i + 1} ·{" "}
                      {o.label ?? `${o.settings.angle}° parking`}
                    </span>
                    <strong>
                      {o.layout.stalls.length} <small>spaces</small>
                    </strong>
                    <b className="option-delta">{o.layout.stalls.length - r.stalls.length >= 0 ? "+" : ""}{o.layout.stalls.length - r.stalls.length} spaces vs. current</b>
                    <span>
                      {o.settings.layoutMode === "paths"
                        ? "Curved circulation"
                        : `${o.settings.orientation}° rows`}{" "}
                      · {Math.round(o.layout.paved).toLocaleString()} ft² paved
                    </span>
                    <span>
                      {o.layout.connected
                        ? "Boundary entrance found"
                        : "Access review needed"}
                    </span>
                    <span className="apply-option">Apply this layout →</span>
                  </button>
                ))}
              </section>
              <section>
                <h2>Saved schemes</h2>
                {schemes.length ? (
                  schemes.map((p, i) => {
                    return (
                      <button
                        className="option-card"
                        key={i}
                        onClick={() => {
                          commit(clone(p.settings));
                          setName(p.name);
                          setLevel(-1);
                        }}
                      >
                        <span>{p.name}</span>
                        <strong>
                          Open scheme
                        </strong>
                        <span>
                          {p.settings.mode} · {p.settings.mode === "garage" ? p.settings.levels : 1} levels · Recalculate in Python
                        </span>
                      </button>
                    );
                  })
                ) : (
                  <p className="note">
                    Save schemes in Save & export to compare them here.
                  </p>
                )}
              </section>
            </>
          )}
          {tab === "Review" && (
            <>
              <section>
                <h2>Layout checks</h2>
                <div className="readout">
                  <span>Boundary entrance</span>
                  <b>{r.connected ? "Connected" : "Not verified"}</b>
                </div>
                {Object.entries(r.counts).map(([k, n]) => (
                  <div className="readout" key={k}>
                    <span className="capitalize">{k}</span>
                    <b>{n}</b>
                  </div>
                ))}
                <div className="readout">
                  <span>Concept paved area</span>
                  <b>{Math.round(r.paved).toLocaleString()} ft²</b>
                </div>
                <ul className="warnings">
                  {r.warnings.map((w, i) => (
                    <li key={i}>{w}</li>
                  ))}
                </ul>
              </section>
              <section>
                <h2>Vehicle turning study</h2>
                <label className="check">
                  <input
                    type="checkbox"
                    checked={turn.enabled}
                    onChange={(e) =>
                      setTurn({ ...turn, enabled: e.target.checked })
                    }
                  />{" "}
                  Show a 90° swept-path sample
                </label>
                {turn.enabled && (
                  <>
                    {numeric("Turn center X", turn.x, -500, 500, (n) =>
                      setTurn({ ...turn, x: n }),
                    )}
                    {numeric("Turn center Z", turn.z, -500, 500, (n) =>
                      setTurn({ ...turn, z: n }),
                    )}
                    {numeric("Centerline radius", turn.radius, 12, 80, (n) =>
                      setTurn({ ...turn, radius: n }),
                    )}
                    {numeric("Vehicle length", turn.length, 12, 50, (n) =>
                      setTurn({ ...turn, length: n }),
                    )}
                    {numeric("Vehicle width", turn.width, 5, 10, (n) =>
                      setTurn({ ...turn, width: n }),
                    )}
                    {numeric(
                      "Turn heading",
                      turn.heading,
                      0,
                      360,
                      (n) => setTurn({ ...turn, heading: n }),
                      "°",
                      15,
                    )}
                    <div className="readout">
                      <span>Conflicting samples</span>
                      <b>{study?.conflicts} / 25</b>
                    </div>
                    <p className="note">
                      Rigid vehicle footprints sampled around a circular turn.
                      Conflicts include site edges, buildings, loading zones and
                      parked stalls. This is not an axle-based vehicle
                      simulation or an automatic route check.
                    </p>
                  </>
                )}
              </section>
            </>
          )}
          {tab === "Files" && (
            <>
              <section>
                <h2>Project files</h2>
                <label className="field">
                  <span>Scheme name</span>
                  <input
                    value={name}
                    maxLength={80}
                    onChange={(e) => setName(e.target.value)}
                  />
                </label>
                <button className="primary wide" onClick={saveScheme}>
                  Save named scheme
                </button>
                <p className="note">
                  The current project autosaves in this browser. Download JSON
                  for a portable backup.
                </p>
                <div className="button-grid">
                  <button onClick={() => exportJSON(s)}>Download JSON</button>
                  <button onClick={() => file.current?.click()}>
                    Open JSON
                  </button>
                </div>
                <input
                  ref={file}
                  type="file"
                  accept=".json,application/json"
                  hidden
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) void importFile(f);
                    e.target.value = "";
                  }}
                />
              </section>
              <section>
                <h2>Design exports</h2>
                <button disabled={!python.ready} className="wide" onClick={() => exportDXF(s, r)}>
                  CAD plan · DXF
                </button>
                <button
                  className="wide"
                  disabled={!python.ready}
                  onClick={() => {
                    if (!python.ready || !glb.current) {
                      setNotice(
                        "3D export is unavailable until WebGL is ready.",
                      );
                      return;
                    }
                    glb
                      .current()
                      .then(() => setNotice("3D model exported in meters."))
                      .catch(() =>
                        setNotice(
                          "3D export failed. Try hiding vehicles and retry.",
                        ),
                      );
                  }}
                >
                  3D model · GLB
                </button>
                <button disabled={!python.ready} className="wide" onClick={() => exportCSV(s, r)}>
                  Quantities + review notes · CSV
                </button>
                <p className="note">
                  DXF uses feet with separate level/type layers. GLB uses meters
                  and the current visible levels and floor spacing; section
                  clipping is not baked into the model. Native RVT and SKP files are not available.
                </p>
              </section>
              <section>
                <h2>Saved schemes</h2>
                {schemes.map((p, i) => (
                  <div className="saved-row" key={i}>
                    <button
                      onClick={() => {
                        commit(clone(p.settings));
                        setName(p.name);
                        setLevel(-1);
                      }}
                    >
                      {p.name}
                    </button>
                    <button
                      aria-label={`Delete scheme ${p.name}`}
                      onClick={() => {
                        const next = schemes.filter((_, j) => j !== i);
                        try {
                          localStorage.setItem(
                            STORAGE + "-schemes",
                            JSON.stringify(next),
                          );
                          setSchemes(next);
                        } catch {
                          setNotice("Could not update browser storage.");
                        }
                      }}
                    >
                      ×
                    </button>
                  </div>
                ))}
              </section>
            </>
          )}
        </aside>
        <main>
          <Scene
            s={s}
            r={r}
            v={v}
            onMove={onMove}
            onSelect={setSelected}
            onDraw={(p) =>
              setDraft((d) =>
                d.length < (tool === "draw-path" ? 40 : 60) ? [...d, p] : d,
              )
            }
            onErase={(id) =>
              patch({ removed: [...s.removed, id.replace(/-L\d+$/, "")] })
            }
            onExportReady={exportReady}
          />
          <div className="canvas-heading">
            <div>
              <span className="eyebrow">
                {name.toUpperCase()} /{" "}
                {s.mode === "garage" ? "STRUCTURED PARKING" : "SURFACE PARKING"}
              </span>
              <h2>{top ? "Site plan" : "Site perspective"}</h2>
            </div>
            <div className="segmented">
              <button
                className={!top ? "active" : ""}
                aria-pressed={!top}
                onClick={() => setTop(false)}
              >
                3D view
              </button>
              <button
                className={top ? "active" : ""}
                aria-pressed={top}
                onClick={() => setTop(true)}
              >
                Plan view
              </button>
            </div>
          </div>
          <div className="tool-ribbon" role="group" aria-label="Editing tools">
            {(Object.keys(labels) as EditorTool[]).map((t) => (
              <button
                key={t}
                className={tool === t ? "active" : ""}
                onClick={() => selectTool(t)}
                disabled={(t === "building" && !s.buildings.length) || (t === "edit-path" && !(s.paths?.length))}
                aria-label={labels[t]}
                aria-pressed={tool === t}
              >
                <span aria-hidden="true">
                  {
                    (
                      {
                        orbit: "↖",
                        boundary: "◇",
                        draw: "⬠",
                        building: "▣",
                        erase: "⌫",
                        "draw-path": "⌁",
                        "edit-path": "⌘",
                      } as Record<EditorTool, string>
                    )[t]
                  }
                </span>
                <span className="tool-label">{labels[t]}</span>
              </button>
            ))}
          </div>
          <div className="display-tools" ref={controlsBar}>
            {!top && <div className="camera-modes" role="group" aria-label="3D navigation">
              <button aria-pressed={navigation === "orbit" && tool === "orbit"} onClick={() => { selectTool("orbit"); setNavigation("orbit"); }}>Orbit</button>
              <button aria-pressed={navigation === "pan" && tool === "orbit"} onClick={() => { selectTool("orbit"); setNavigation("pan"); }}>Pan</button>
            </div>}
            <button className="fit-button" onClick={() => setFit((n) => n + 1)}>
              Fit site <kbd>F</kbd>
            </button>
            <div className="zoom-buttons" role="group" aria-label="Camera zoom">
              <button aria-label="Zoom in" title="Zoom in" onClick={() => setZoom(z => ({id:z.id+1,direction:"in"}))}>＋</button>
              <button aria-label="Zoom out" title="Zoom out" onClick={() => setZoom(z => ({id:z.id+1,direction:"out"}))}>−</button>
            </div>
            <button aria-expanded={showControls} aria-controls="controls-guide" onClick={() => setShowControls((value) => !value)}>
              Mouse controls
            </button>
            <label>
              <input
                type="checkbox"
                checked={cars}
                onChange={(e) => setCars(e.target.checked)}
              />{" "}
              Vehicles
            </label>
            <label>
              <input
                type="checkbox"
                checked={dimensions}
                onChange={(e) => setDimensions(e.target.checked)}
              />{" "}
              Dimensions
            </label>
            <button disabled={busy || !python.ready} onClick={generate}>
              {busy ? "Comparing…" : "Compare layouts"}
            </button>
          </div>
          {showControls && (
            <div className="controls-guide" id="controls-guide">
              <div className="guide-heading"><b>Move around your site</b><button onClick={() => setShowControls(false)} aria-label="Close mouse controls">×</button></div>
              <dl>
                <dt>Rotate in 3D</dt><dd>Choose Orbit, then drag</dd>
                <dt>Move sideways in 3D</dt><dd>Choose Pan, then drag</dd>
                <dt>Pan in plan</dt><dd>Left-drag in Explore</dd>
                <dt>Pan with any tool</dt><dd>Right-drag</dd>
                <dt>Zoom</dt><dd>Scroll, pinch, or use + / −</dd>
                <dt>Show the whole site</dt><dd><kbd>F</kbd> or Fit site</dd>
                <dt>Leave an editing tool</dt><dd><kbd>Esc</kbd> or Done editing</dd>
              </dl>
              <p>Edits update parking automatically. Use Undo to restore the previous layout.</p>
              <p>Drag empty space to pan while editing. On touch screens, use two fingers to pan and pinch. Switching back from Plan restores your previous 3D angle.</p>
            </div>
          )}
          <div className="legend">
            <span>
              <i style={{ background: "#728087" }} />
              Standard
            </span>
            <span>
              <i style={{ background: "#3976a0" }} />
              Accessible
            </span>
            <span>
              <i style={{ background: "#547c61" }} />
              EV
            </span>
            <span>
              <i style={{ background: "#b99a63" }} />
              Loading / ramps
            </span>
          </div>
          <div className="help">
            {tool === "orbit"
              ? top ? "Drag to pan · Scroll or pinch to zoom · F fits the site" : navigation === "pan" ? "Drag to pan · Scroll to zoom · Choose Orbit to rotate" : "Drag to orbit · Scroll to zoom · Right-drag or choose Pan to move"
              : tool === "edit-path"
                ? "Drag blue curve points · Scroll to zoom · Right-drag to pan · Esc to exit"
                : tool === "draw-path"
                  ? "Click to place curve points · Finish aisle to generate parking"
                  : tool === "boundary"
                    ? "Drag a blue vertex · Scroll to zoom · Right-drag to pan · Esc to exit"
                    : tool === "building"
                      ? "Drag a building on the ground plane · Use Site controls to resize and rotate"
                      : tool === "erase"
                        ? "Click a stall footprint to remove its position"
                        : "Click points on the ground to draw a site"}
          </div>
          {!python.ready && <div className="python-status" role={python.error ? "alert" : "status"}>
            <b>{python.error ? "Python solver unavailable" : "Calculating in Python…"}</b>
            <span>{python.error || "Your site is editable. Parking and exports will update when the calculation finishes."}</span>
            {python.error && <button onClick={python.retry}>Retry calculation</button>}
          </div>}
          <div className="scorecard-wrap">
          <div className="stall-breakdown" aria-label="Parking mix">
            <span className="solve-state">{python.pending ? "Updating…" : python.ready ? "Layout calculated" : "Calculation unavailable"}</span>
            {(["standard", "compact", "accessible", "ev"] as const).map(kind => <span key={kind}><b>{python.ready ? r.counts[kind] : "—"}</b> {kind === "ev" ? "EV" : kind === "accessible" ? "Accessible" : kind}</span>)}
            <button onClick={() => { setTab("Dashboard"); selectTool("orbit"); }}>Full dashboard →</button>
          </div>
          <div className="stats" aria-busy={python.pending}>
            <div>
              <span>Parking spaces</span>
              <strong>
                {python.ready ? r.stalls.length : "—"}
              </strong>
            </div>
            <div>
              <span>Site area</span>
              <strong>
                {(r.area / 43560).toFixed(2)}
                <small> acres</small>
              </strong>
            </div>
            <div>
              <span>Parking levels</span>
              <strong>
                {r.levelCount}
                <small> {s.mode}</small>
              </strong>
            </div>
            <div>
              <span>Land per space</span>
              <strong>
                {r.stalls.length ? Math.round(r.area / r.stalls.length) : "—"}
                <small> ft²</small>
              </strong>
            </div>
          </div>
          </div>
          {python.ready && !r.stalls.length && tool !== "draw" && tool !== "draw-path" && (
            <div className="empty" role="status">
              {r.connected
                ? "No stalls fit the current parking settings. Enable parking on an aisle side or increase the available space."
                : "No connected layout fits these settings. Open Results → Checks, connect an aisle to the site edge, or try another orientation."}
            </div>
          )}
        </main>
      </div>
      <footer>
        <span>
          PYTHON ENGINE <b>·</b> Feet <b>·</b> Browser autosave
        </span>
        <button onClick={() => setTab("Review")}>
          {r.warnings.length} review notes · Open checks
        </button>
      </footer>
      {notice && (
        <div className="toast" role="status">
          {notice}
        </div>
      )}
    </div>
  );
}
