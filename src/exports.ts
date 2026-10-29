import { area, type Settings, type Layout, type Point } from "./solver.ts";
import { samplePath } from "./curves.ts";
export function download(
  data: string | Blob,
  name: string,
  type = "application/json",
) {
  const blob = typeof data === "string" ? new Blob([data], { type }) : data;
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
export function exportJSON(s: Settings) {
  download(
    JSON.stringify({ version: 2, units: "feet", settings: s }, null, 2),
    "parking-project.json",
  );
}
export function exportCSV(s: Settings, r: Layout) {
  const rows = [
    ["Metric", "Value", "Unit"],
    ["Site area", r.area, "sq ft"],
    ["Spaces", r.stalls.length, "spaces"],
    ["Levels", r.levelCount, "levels"],
    [
      "Building area",
      r.buildingPolys.reduce((n, p) => n + area(p), 0),
      "sq ft",
    ],
    ["Concept paved area", Math.round(r.paved), "sq ft"],
    ...Object.entries(r.counts).map(([k, v]) => [k, v, "spaces"]),
    ...Array.from({ length: r.levelCount }, (_, i) => [
      `Level ${i + 1}`,
      r.stalls.filter((p) => p.level === i).length,
      "spaces",
    ]),
    ...r.warnings.map((w) => ["Review note", w, ""]),
  ];
  download(
    rows
      .map((row) =>
        row.map((v) => '"' + String(v).replaceAll('"', '""') + '"').join(","),
      )
      .join("\r\n"),
    "parking-quantities.csv",
    "text/csv",
  );
}
export function exportDXF(s: Settings, r: Layout) {
  let out =
    "0\nSECTION\n2\nHEADER\n9\n$INSUNITS\n70\n2\n0\nENDSEC\n0\nSECTION\n2\nENTITIES\n";
  const poly = (p: Point[], layer: string, y = 0, closed = true) => {
    p.forEach((a, i) => {
      if (!closed && i === p.length - 1) return;
      const b = p[(i + 1) % p.length];
      out += `0\nLINE\n8\n${layer}\n10\n${a.x}\n20\n${-a.z}\n30\n${y}\n11\n${b.x}\n21\n${-b.z}\n31\n${y}\n`;
    });
  };
  poly(s.boundary, "SITE");
  if (s.layoutMode === "paths")
    for (const path of s.paths ?? [])
      poly(samplePath(path), "CURVE_CENTERLINES", 0, false);
  r.buildingPolys.forEach((p) => poly(p, "BUILDINGS"));
  r.stalls.forEach((p) => {
    poly(
      p.poly,
      `L${p.level + 1}_${p.kind.toUpperCase()}`,
      p.level * s.floorHeight,
    );
    if (p.access)
      poly(p.access, `L${p.level + 1}_ACCESS`, p.level * s.floorHeight);
  });
  for (let l = 0; l < r.levelCount; l++)
    r.aisles.forEach((p) =>
      poly(p.poly, `L${l + 1}_AISLES`, l * s.floorHeight),
    );
  r.ramps.forEach((p) =>
    poly(p.poly, "RAMP_FOOTPRINT", (p.level ?? 0) * s.floorHeight),
  );
  if (r.loading) poly(r.loading.poly, "LOADING");
  if (r.entrance) poly(r.entrance.poly, "ENTRANCE");
  out += "0\nENDSEC\n0\nEOF\n";
  download(out, "parking-layout.dxf", "application/dxf");
}
