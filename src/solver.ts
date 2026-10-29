import type { DrivePath } from "./curves.ts";
export type Point = { x: number; z: number };
export type Kind = "standard" | "accessible" | "ev" | "compact";
export type Building = {
  id: string;
  x: number;
  z: number;
  w: number;
  d: number;
  height: number;
  rotation: number;
};
export type Settings = {
  layoutMode?: "fill" | "paths";
  paths?: DrivePath[];
  boundary: Point[];
  buildings: Building[];
  setback: number;
  stallWidth: number;
  stallDepth: number;
  aisle: number;
  angle: number;
  orientation: number;
  accessible: number;
  evPercent: number;
  compactPercent: number;
  loading: boolean;
  loadingX: number;
  loadingZ: number;
  mode: "surface" | "garage";
  levels: number;
  floorHeight: number;
  rampSlope: number;
  slopeX: number;
  slopeZ: number;
  target: number;
  removed: string[];
  entranceSide: "south" | "north";
};
export type Shape = { id: string; poly: Point[]; kind?: Kind; level?: number };
export type Stall = Shape & { kind: Kind; level: number; access?: Point[] };
export type Layout = {
  stalls: Stall[];
  aisles: Shape[];
  ramps: Shape[];
  columns: Point[];
  loading: Shape | null;
  entrance: Shape | null;
  warnings: string[];
  area: number;
  paved: number;
  levelCount: number;
  connected: boolean;
  buildingPolys: Point[][];
  counts: Record<Kind, number>;
  rampLength: number;
  floor: Point[];
};
export const rectangle = (w: number, d: number, x = 0, z = 0): Point[] => [
  { x: x - w / 2, z: z - d / 2 },
  { x: x + w / 2, z: z - d / 2 },
  { x: x + w / 2, z: z + d / 2 },
  { x: x - w / 2, z: z + d / 2 },
];
export const defaults: Settings = {
  boundary: rectangle(260, 240),
  buildings: [
    { id: "building-1", x: 20, z: -78, w: 85, d: 50, height: 36, rotation: 0 },
  ],
  setback: 8,
  stallWidth: 9,
  stallDepth: 18,
  aisle: 24,
  angle: 90,
  orientation: 0,
  accessible: 4,
  evPercent: 10,
  compactPercent: 10,
  loading: false,
  loadingX: 80,
  loadingZ: -30,
  mode: "surface",
  levels: 3,
  floorHeight: 11,
  rampSlope: 12,
  slopeX: 0,
  slopeZ: 0,
  target: 100,
  removed: [],
  entranceSide: "south",
};
export const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v));
export function rotate(p: Point, degrees: number): Point {
  const a = (degrees * Math.PI) / 180;
  return {
    x: p.x * Math.cos(a) - p.z * Math.sin(a),
    z: p.x * Math.sin(a) + p.z * Math.cos(a),
  };
}
export const transform = (poly: Point[], degrees: number, x = 0, z = 0) =>
  poly.map((p) => {
    const q = rotate(p, degrees);
    return { x: q.x + x, z: q.z + z };
  });
export const buildingPoly = (b: Building) =>
  transform(rectangle(b.w, b.d), b.rotation, b.x, b.z);
export function area(p: Point[]) {
  return Math.abs(
    p.reduce((a, v, i) => {
      const q = p[(i + 1) % p.length];
      return a + v.x * q.z - q.x * v.z;
    }, 0) / 2,
  );
}
export function bounds(p: Point[]) {
  return {
    minX: Math.min(...p.map((v) => v.x)),
    maxX: Math.max(...p.map((v) => v.x)),
    minZ: Math.min(...p.map((v) => v.z)),
    maxZ: Math.max(...p.map((v) => v.z)),
  };
}
export const center = (p: Point[]) => ({
  x: p.reduce((a, v) => a + v.x, 0) / p.length,
  z: p.reduce((a, v) => a + v.z, 0) / p.length,
});
const cross = (a: Point, b: Point, c: Point) =>
  (b.x - a.x) * (c.z - a.z) - (b.z - a.z) * (c.x - a.x);
export function distance(p: Point, a: Point, b: Point) {
  const dx = b.x - a.x,
    dz = b.z - a.z,
    t = Math.max(
      0,
      Math.min(
        1,
        ((p.x - a.x) * dx + (p.z - a.z) * dz) / (dx * dx + dz * dz || 1),
      ),
    );
  return Math.hypot(p.x - a.x - t * dx, p.z - a.z - t * dz);
}
export function inside(p: Point, poly: Point[]) {
  let yes = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i],
      b = poly[j];
    if (distance(p, a, b) < 1e-7) return true;
    if (
      a.z > p.z !== b.z > p.z &&
      p.x < ((b.x - a.x) * (p.z - a.z)) / (b.z - a.z) + a.x
    )
      yes = !yes;
  }
  return yes;
}
function intersects(a: Point, b: Point, c: Point, d: Point) {
  return (
    cross(a, b, c) * cross(a, b, d) < -1e-7 &&
    cross(c, d, a) * cross(c, d, b) < -1e-7
  );
}
export function validBoundary(p: Point[]) {
  if (
    p.length < 3 ||
    p.length > 60 ||
    p.some(
      (q) =>
        !Number.isFinite(q.x) ||
        !Number.isFinite(q.z) ||
        Math.abs(q.x) > 1000 ||
        Math.abs(q.z) > 1000,
    ) ||
    area(p) < 500
  )
    return false;
  for (let i = 0; i < p.length; i++) {
    if (
      Math.hypot(
        p[i].x - p[(i + 1) % p.length].x,
        p[i].z - p[(i + 1) % p.length].z,
      ) < 0.1
    )
      return false;
    for (let j = i + 2; j < p.length; j++) {
      if (i === 0 && j === p.length - 1) continue;
      const a = p[i],
        b = p[(i + 1) % p.length],
        c = p[j],
        d = p[(j + 1) % p.length];
      if (
        intersects(a, b, c, d) ||
        distance(a, c, d) < 1e-7 ||
        distance(b, c, d) < 1e-7 ||
        distance(c, a, b) < 1e-7 ||
        distance(d, a, b) < 1e-7
      )
        return false;
    }
  }
  return true;
}
export function contained(poly: Point[], site: Point[], margin = 0) {
  for (const p of poly) if (!inside(p, site)) return false;
  for (let i = 0; i < poly.length; i++)
    for (let j = 0; j < site.length; j++) {
      const a = poly[i],
        b = poly[(i + 1) % poly.length],
        c = site[j],
        d = site[(j + 1) % site.length];
      if (intersects(a, b, c, d)) return false;
      if (
        Math.min(
          distance(a, c, d),
          distance(b, c, d),
          distance(c, a, b),
          distance(d, a, b),
        ) <
        margin - 1e-6
      )
        return false;
    }
  return true;
}
export function overlaps(a: Point[], b: Point[]) {
  for (const p of [a, b])
    for (let i = 0; i < p.length; i++) {
      const q = p[(i + 1) % p.length],
        n = { x: -(q.z - p[i].z), z: q.x - p[i].x };
      const aa = a.map((v) => v.x * n.x + v.z * n.z),
        bb = b.map((v) => v.x * n.x + v.z * n.z);
      if (
        Math.max(...aa) <= Math.min(...bb) + 1e-6 ||
        Math.max(...bb) <= Math.min(...aa) + 1e-6
      )
        return false;
    }
  return true;
}
export function validateProject(value: unknown): Settings {
  const v = value as { settings?: Settings };
  const s = v?.settings;
  if (s?.layoutMode !== undefined && !["fill", "paths"].includes(s.layoutMode))
    throw new Error("Invalid layout mode.");
  if (s?.paths !== undefined) {
    if (!Array.isArray(s.paths) || s.paths.length > 12)
      throw new Error("Invalid path list.");
    const ids = new Set<string>();
    for (const p of s.paths) {
      if (
        !p ||
        typeof p.id !== "string" ||
        ids.has(p.id) ||
        typeof p.name !== "string" ||
        p.name.length > 80 ||
        !Array.isArray(p.points) ||
        p.points.length < 2 ||
        p.points.length > 40 ||
        p.points.some(
          (q) =>
            !q ||
            !Number.isFinite(q.x) ||
            !Number.isFinite(q.z) ||
            Math.abs(q.x) > 1000 ||
            Math.abs(q.z) > 1000,
        ) ||
        typeof p.smooth !== "boolean" ||
        typeof p.closed !== "boolean" ||
        (p.closed && p.points.length < 3) ||
        !Number.isFinite(p.width) ||
        p.width < 16 ||
        p.width > 36 ||
        !["both", "left", "right", "none"].includes(p.parking)
      )
        throw new Error("Invalid curved path.");
      ids.add(p.id);
    }
  }
  if (!s || !Array.isArray(s.boundary) || !validBoundary(s.boundary))
    throw new Error("Project needs a valid site polygon.");
  const ranges: Record<string, [number, number]> = {
    setback: [0, 40],
    stallWidth: [8, 14],
    stallDepth: [16, 24],
    aisle: [20, 36],
    angle: [45, 90],
    orientation: [0, 180],
    accessible: [0, 30],
    evPercent: [0, 100],
    compactPercent: [0, 100],
    levels: [1, 8],
    floorHeight: [9, 16],
    rampSlope: [5, 15],
    slopeX: [-10, 10],
    slopeZ: [-10, 10],
    target: [0, 3000],
    loadingX: [-1000, 1000],
    loadingZ: [-1000, 1000],
  };
  for (const [key, [min, max]] of Object.entries(ranges)) {
    const n = (s as unknown as Record<string, unknown>)[key];
    if (typeof n !== "number" || !Number.isFinite(n) || n < min || n > max)
      throw new Error(`Invalid ${key}.`);
  }
  if (
    !["surface", "garage"].includes(s.mode) ||
    !["north", "south"].includes(s.entranceSide) ||
    ![45, 60, 90].includes(s.angle) ||
    s.levels % 1 ||
    s.accessible % 1 ||
    typeof s.loading !== "boolean" ||
    !Array.isArray(s.removed) ||
    s.removed.length > 10000 ||
    s.removed.some((x) => typeof x !== "string") ||
    !Array.isArray(s.buildings) ||
    s.buildings.length > 12
  )
    throw new Error("Invalid project settings.");
  for (const b of s.buildings)
    if (
      !b ||
      typeof b.id !== "string" ||
      Object.entries({
        x: 1000,
        z: 1000,
        w: 300,
        d: 300,
        height: 200,
        rotation: 360,
      }).some(([k, max]) => {
        const n = (b as unknown as Record<string, number>)[k];
        return (
          !Number.isFinite(n) ||
          Math.abs(n) > max ||
          (["w", "d", "height"].includes(k) && n < 1)
        );
      })
    )
      throw new Error("Invalid building.");
  return clone(s);
}
