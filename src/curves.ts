import type { Point } from "./solver.ts";
export type DrivePath = {
  id: string;
  name: string;
  points: Point[];
  closed: boolean;
  smooth: boolean;
  width: number;
  parking: "both" | "left" | "right" | "none";
};
export function roundedSite(w = 320, d = 260, r = 45): Point[] {
  r = Math.min(r, w / 2, d / 2);
  const p: Point[] = [];
  for (const [x, z, start] of [
    [w / 2 - r, -d / 2 + r, -90],
    [w / 2 - r, d / 2 - r, 0],
    [-w / 2 + r, d / 2 - r, 90],
    [-w / 2 + r, -d / 2 + r, 180],
  ])
    for (let i = 0; i <= 8; i++) {
      const a = ((start + (i * 90) / 8) * Math.PI) / 180;
      p.push({ x: x + r * Math.cos(a), z: z + r * Math.sin(a) });
    }
  return p;
}
export function ellipseSite(w = 340, d = 280): Point[] {
  return Array.from({ length: 48 }, (_, i) => ({
    x: (w / 2) * Math.cos((i * Math.PI) / 24),
    z: (d / 2) * Math.sin((i * Math.PI) / 24),
  }));
}
export function samplePath(path: DrivePath): Point[] {
  const p = path.points;
  if (p.length < 2) return [];
  const result: Point[] = [];
  const at = (i: number) =>
    p[
      path.closed
        ? (i + p.length) % p.length
        : Math.max(0, Math.min(p.length - 1, i))
    ];
  for (let i = 0; i < (path.closed ? p.length : p.length - 1); i++) {
    const a = at(i - 1),
      b = at(i),
      c = at(i + 1),
      d = at(i + 2),
      steps = Math.max(
        3,
        Math.min(120, Math.ceil(Math.hypot(c.x - b.x, c.z - b.z) / 3)),
      );
    for (let j = 0; j < steps; j++) {
      const t = j / steps,
        t2 = t * t,
        t3 = t2 * t;
      const value = (k: "x" | "z") =>
        path.smooth
          ? 0.5 *
            (2 * b[k] +
              (-a[k] + c[k]) * t +
              (2 * a[k] - 5 * b[k] + 4 * c[k] - d[k]) * t2 +
              (-a[k] + 3 * b[k] - 3 * c[k] + d[k]) * t3)
          : b[k] + (c[k] - b[k]) * t;
      result.push({ x: value("x"), z: value("z") });
    }
  }
  result.push({ ...at(path.closed ? 0 : p.length - 1) });
  return result;
}
const cross = (a: Point, b: Point, c: Point) =>
  (b.x - a.x) * (c.z - a.z) - (b.z - a.z) * (c.x - a.x);
export function triangulate(poly: Point[]): Point[][] {
  const signed = poly.reduce(
    (n, p, i) =>
      n +
      p.x * poly[(i + 1) % poly.length].z -
      poly[(i + 1) % poly.length].x * p.z,
    0,
  );
  const pts = signed > 0 ? [...poly] : [...poly].reverse(),
    triangles: Point[][] = [];
  let guard = 0;
  while (pts.length > 3 && guard++ < poly.length * poly.length) {
    let cut = false;
    for (let i = 0; i < pts.length; i++) {
      const a = pts[(i + pts.length - 1) % pts.length],
        b = pts[i],
        c = pts[(i + 1) % pts.length];
      if (cross(a, b, c) <= 1e-8) continue;
      if (
        pts.some(
          (p) =>
            p !== a &&
            p !== b &&
            p !== c &&
            cross(a, b, p) >= -1e-8 &&
            cross(b, c, p) >= -1e-8 &&
            cross(c, a, p) >= -1e-8,
        )
      )
        continue;
      triangles.push([a, b, c]);
      pts.splice(i, 1);
      cut = true;
      break;
    }
    if (!cut) break;
  }
  if (pts.length === 3) triangles.push([...pts]);
  return triangles;
}
export function clipConvex(subject: Point[], triangle: Point[]): Point[] {
  let output = [...subject];
  for (let i = 0; i < triangle.length; i++) {
    const a = triangle[i],
      b = triangle[(i + 1) % triangle.length],
      input = output;
    output = [];
    if (!input.length) break;
    let prev = input[input.length - 1],
      dp = cross(a, b, prev);
    for (const next of input) {
      const dn = cross(a, b, next);
      if (dn >= -1e-8 !== dp >= -1e-8) {
        const t = dp / (dp - dn);
        output.push({
          x: prev.x + (next.x - prev.x) * t,
          z: prev.z + (next.z - prev.z) * t,
        });
      }
      if (dn >= -1e-8) output.push(next);
      prev = next;
      dp = dn;
    }
  }
  return output.filter(
    (p, i) =>
      i === 0 ||
      Math.hypot(p.x - output[i - 1].x, p.z - output[i - 1].z) > 1e-6,
  );
}
export function pathFrames(points: Point[], closed: boolean, width: number) {
  return points.map((p, i) => {
    const before = points[i === 0 ? (closed ? points.length - 2 : 0) : i - 1],
      after = points[i === points.length - 1 ? (closed ? 1 : i) : i + 1];
    let dx = after.x - before.x,
      dz = after.z - before.z;
    const length = Math.hypot(dx, dz) || 1;
    dx /= length;
    dz /= length;
    return {
      p,
      t: { x: dx, z: dz },
      n: { x: -dz, z: dx },
      left: { x: p.x - (dz * width) / 2, z: p.z + (dx * width) / 2 },
      right: { x: p.x + (dz * width) / 2, z: p.z - (dx * width) / 2 },
    };
  });
}
export function curvePreset(kind: "sweep" | "loop"): {
  boundary: Point[];
  paths: DrivePath[];
} {
  const common = {
    width: 24,
    smooth: true,
    closed: false,
    parking: "both" as const,
  };
  if (kind === "sweep")
    return {
      boundary: roundedSite(360, 280, 35),
      paths: [
        {
          ...common,
          id: "sweep",
          name: "Curved drive",
          points: [
            { x: -180, z: 65 },
            { x: -95, z: 70 },
            { x: 0, z: 0 },
            { x: 95, z: -70 },
            { x: 180, z: -65 },
          ],
        },
      ],
    };
  return {
    boundary: roundedSite(320, 280, 40),
    paths: [
      {
        ...common,
        id: "loop",
        name: "Loop road",
        closed: true,
        points: [
          { x: 0, z: -72 },
          { x: 90, z: 0 },
          { x: 0, z: 72 },
          { x: -90, z: 0 },
        ],
      },
      {
        ...common,
        id: "entry",
        name: "Entry connector",
        parking: "none",
        smooth: false,
        points: [
          { x: 0, z: -140 },
          { x: 0, z: -72 },
        ],
      },
    ],
  };
}
