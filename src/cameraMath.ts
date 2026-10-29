/** Distance needed to contain camera-space corners, with padding inside the frame. */
export function fitDistance(corners: { x: number; y: number; z: number }[], verticalFov: number, aspect: number, padding = 1.15) {
  const tangent = Math.tan(verticalFov * Math.PI / 360);
  const horizontal = tangent * Math.max(0.05, aspect);
  return Math.max(30, ...corners.map(p => p.z + padding * Math.max(Math.abs(p.x) / horizontal, Math.abs(p.y) / tangent)));
}

export function zoomDistance(distance: number, direction: "in" | "out", min: number, max: number) {
  return Math.max(min, Math.min(max, distance * (direction === "in" ? 0.8 : 1.25)));
}
