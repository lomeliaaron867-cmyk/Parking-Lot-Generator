import {
  transform,
  rectangle,
  contained,
  overlaps,
  type Settings,
  type Layout,
  type Point,
} from "./solver.ts";
export type Turn = {
  enabled: boolean;
  x: number;
  z: number;
  radius: number;
  length: number;
  width: number;
  heading: number;
};
export const defaultTurn: Turn = {
  enabled: false,
  x: -70,
  z: 20,
  radius: 25,
  length: 18,
  width: 7,
  heading: 0,
};
export function turningStudy(s: Settings, r: Layout, t: Turn) {
  const samples: Point[][] = [];
  let conflicts = 0;
  for (let i = 0; i <= 24; i++) {
    const a = ((i / 24) * Math.PI) / 2,
      c = { x: t.radius * Math.cos(a), z: t.radius * Math.sin(a) };
    const vehicle = transform(
      transform(rectangle(t.width, t.length), (-a * 180) / Math.PI, c.x, c.z),
      t.heading,
      t.x,
      t.z,
    );
    samples.push(vehicle);
    if (
      !contained(vehicle, s.boundary) ||
      [
        ...r.buildingPolys,
        ...r.stalls.filter((p) => p.level === 0).map((p) => p.poly),
        ...(r.loading ? [r.loading.poly] : []),
      ].some((p) => overlaps(vehicle, p))
    )
      conflicts++;
  }
  return { samples, conflicts };
}
