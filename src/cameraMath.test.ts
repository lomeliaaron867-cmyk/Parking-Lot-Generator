import assert from "node:assert/strict";
import { fitDistance, zoomDistance } from "./cameraMath.ts";

const corners = [-180,180].flatMap(x => [-50,50].flatMap(y => [-140,140].map(z => ({x,y,z}))));
for (const aspect of [0.3, 0.75, 1, 2, 4]) {
  const d = fitDistance(corners, 42, aspect);
  const tan = Math.tan(42 * Math.PI / 360);
  for (const p of corners) {
    assert.ok(d > p.z);
    assert.ok(Math.abs(p.x) / (d-p.z) <= tan * aspect / 1.15 + 1e-9);
    assert.ok(Math.abs(p.y) / (d-p.z) <= tan / 1.15 + 1e-9);
  }
}
assert.ok(fitDistance(corners,42,0.3)>fitDistance(corners,42,2));
assert.equal(zoomDistance(100,"in",30,500),80);
assert.equal(zoomDistance(100,"out",30,500),125);
assert.equal(zoomDistance(31,"in",30,500),30);
assert.equal(zoomDistance(490,"out",30,500),500);
console.log("Camera framing and bounded zoom checks passed.");
