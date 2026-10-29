import { useEffect, useRef, useState } from "react";
import * as T from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { GLTFExporter } from "three/addons/exporters/GLTFExporter.js";
import {
  bounds,
  center,
  rectangle,
  type Point,
  type Settings,
  type Layout,
} from "./solver";
import { turningStudy, type Turn } from "./turning";
import { download } from "./exports";
import { samplePath } from "./curves";
import { watchPointerRecovery } from "./pointerRecovery";
import { fitDistance, zoomDistance } from "./cameraMath";
export type EditorTool =
  | "orbit"
  | "boundary"
  | "draw"
  | "building"
  | "erase"
  | "draw-path"
  | "edit-path";
export type ViewOptions = {
  top: boolean;
  cars: boolean;
  dimensions: boolean;
  explode: number;
  section: boolean;
  level: number;
  tool: EditorTool;
  selected: string;
  draft: Point[];
  selectedPath: string;
  fit: number;
  navigation: "orbit" | "pan";
  zoom: { id: number; direction: "in" | "out" };
  turn: Turn;
};
type Props = {
  s: Settings;
  r: Layout;
  v: ViewOptions;
  onMove: (type: string, id: string, p: Point) => void;
  onSelect: (id: string) => void;
  onDraw: (p: Point) => void;
  onErase: (id: string) => void;
  onExportReady: (fn: () => Promise<void>) => void;
};
type Engine = {
  renderer: T.WebGLRenderer;
  scene: T.Scene;
  camera: T.PerspectiveCamera;
  controls: OrbitControls;
  content: T.Group;
  cancelInteraction?: () => void;
  savedPerspective?: { position: T.Vector3; target: T.Vector3 };
  previousTop?: boolean;
  previousFit?: number;
  previousMode?: string;
};
const colors = {
  standard: "#dce4e5",
  accessible: "#69b5ec",
  ev: "#a4dc77",
  compact: "#d7b991",
};
function dispose(root: T.Object3D) {
  root.traverse((o) => {
    if (o instanceof T.Mesh || o instanceof T.Line) {
      o.geometry.dispose();
      const m = Array.isArray(o.material) ? o.material : [o.material];
      m.forEach((x: T.Material) => {
        const tex = (x as T.MeshBasicMaterial).map;
        if (tex) tex.dispose();
        x.dispose();
      });
    }
  });
}
export default function Scene(props: Props) {
  const host = useRef<HTMLDivElement>(null),
    engine = useRef<Engine | null>(null),
    latest = useRef(props);
  latest.current = props;
  const [error, setError] = useState("");
  useEffect(() => {
    const el = host.current!;
    let renderer: T.WebGLRenderer;
    try {
      renderer = new T.WebGLRenderer({ antialias: true });
    } catch {
      setError(
        "WebGL is unavailable. Enable hardware acceleration to use the 3D editor.",
      );
      return;
    }
    renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
    renderer.toneMapping = T.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = T.PCFSoftShadowMap;
    renderer.localClippingEnabled = true;
    renderer.domElement.tabIndex = 0;
    renderer.domElement.setAttribute("aria-label", "Parking layout canvas. Drag to navigate; F fits the site and Escape exits an editing tool.");
    renderer.domElement.style.userSelect = "none";
    el.appendChild(renderer.domElement);
    const scene = new T.Scene();
    scene.background = new T.Color("#f2f1ed");
    const camera = new T.PerspectiveCamera(42, 1, 0.5, 5000);
    camera.position.set(290, 260, 290);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = false;
    controls.zoomToCursor = false;
    controls.zoomSpeed = 0.65;
    controls.rotateSpeed = 0.65;
    controls.panSpeed = 0.85;
    controls.screenSpacePanning = false;
    controls.minDistance = 30;
    controls.maxDistance = 4500;
    controls.maxPolarAngle = Math.PI / 2 - 0.10;
    scene.add(new T.HemisphereLight(0xffffff, 0x6b817b, 2.5));
    const sun = new T.DirectionalLight(0xffffff, 3);
    sun.position.set(-180, 300, 150);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    Object.assign(sun.shadow.camera, {
      left: -500,
      right: 500,
      top: 500,
      bottom: -500,
      far: 1000,
    });
    sun.shadow.bias = -0.001;
    scene.add(sun);
    const content = new T.Group();
    scene.add(content);
    engine.current = { renderer, scene, camera, controls, content };
    const resize = () => {
      renderer.setSize(Math.max(1,el.clientWidth), Math.max(1,el.clientHeight));
      camera.aspect = Math.max(1,el.clientWidth) / Math.max(1,el.clientHeight);
      camera.updateProjectionMatrix();
    };
    const observer = new ResizeObserver(resize);
    observer.observe(el);
    resize();
    let frame = 0;
    const tick = () => {
      frame = requestAnimationFrame(tick);
      controls.update();
      renderer.render(scene, camera);
    };
    tick();
    const ray = new T.Raycaster(),
      mouse = new T.Vector2(),
      plane = new T.Plane(new T.Vector3(0, 1, 0), 0);
    let drag: {
        type: string;
        id: string;
        object: T.Object3D;
        start: T.Vector3;
        position: T.Vector3;
      } | null = null,
      startPixel = { x: 0, y: 0 };
    let activePointer: number | null = null;
    let touchGesture = false;
    const idleCursor = () => latest.current.v.tool === "orbit" ? "grab" :
      ["boundary", "building", "edit-path"].includes(latest.current.v.tool) ? "move" : "crosshair";
    const hit = (e: PointerEvent) => {
      const b = renderer.domElement.getBoundingClientRect();
      mouse.set(
        ((e.clientX - b.left) / b.width) * 2 - 1,
        (-(e.clientY - b.top) / b.height) * 2 + 1,
      );
      ray.setFromCamera(mouse, camera);
      const point = new T.Vector3();
      return ray.ray.intersectPlane(plane, point);
    };
    const down = (e: PointerEvent) => {
      if (e.pointerType === "touch" && !e.isPrimary) {
        touchGesture = true;
        if (drag) drag.object.position.copy(drag.position);
        drag = null; activePointer = null; controls.enabled = true;
        return;
      }
      if (e.button !== 0 || activePointer !== null) return;
      touchGesture = false;
      const point = hit(e);
      if (!point) return;
      e.preventDefault();
      renderer.domElement.focus({preventScroll:true});
      activePointer = e.pointerId;
      renderer.domElement.setPointerCapture(e.pointerId);
      startPixel = { x: e.clientX, y: e.clientY };
      const p = latest.current;
      if (p.v.tool === "draw" || p.v.tool === "draw-path") {
        return;
      }
      if (p.v.tool === "orbit") return;
      const hits = ray.intersectObjects(content.children, true);
      let obj: T.Object3D | undefined;
      // Handles remain easy to pick at any zoom, even over a stall or building.
      if (p.v.tool === "boundary" || p.v.tool === "edit-path") {
        const rect = renderer.domElement.getBoundingClientRect();
        let nearest = 14;
        content.children.forEach((candidate) => {
          const wanted = p.v.tool === "boundary" ? "vertex" : "path-node";
          if (candidate.userData.type !== wanted) return;
          const projected = candidate.position.clone().project(camera);
          if (projected.z < -1 || projected.z > 1) return;
          const distance = Math.hypot(
            rect.left + (projected.x + 1) * rect.width / 2 - e.clientX,
            rect.top + (1 - projected.y) * rect.height / 2 - e.clientY,
          );
          if (distance < nearest) { nearest = distance; obj = candidate; }
        });
      }
      for (const h of hits) {
        if (obj) break;
        let a: T.Object3D | null = h.object;
        while (a && a !== content) {
          if (a.userData.type === "building" && p.v.tool === "building") {
            obj = a;
            break;
          }
          a = a.parent;
        }
        if (obj) break;
      }
      if (!obj) return;
      const { type, id } = obj.userData;
      if (
        (type === "vertex" && p.v.tool === "boundary") ||
        (type === "path-node" && p.v.tool === "edit-path") ||
        (type === "building" && p.v.tool === "building")
      ) {
        controls.enabled = false;
        renderer.domElement.style.cursor = "grabbing";
        drag = {
          type,
          id,
          object: obj,
          start: point.clone(),
          position: obj.position.clone(),
        };
        renderer.domElement.setPointerCapture(e.pointerId);
      }
    };
    const move = (e: PointerEvent) => {
      if (!drag || e.pointerId !== activePointer) return;
      const point = hit(e);
      if (!point) return;
      drag.object.position.x =
        drag.position.x + point.x - drag.start.x;
      drag.object.position.z =
        drag.position.z + point.z - drag.start.z;
    };
    const up = (e: PointerEvent) => {
      if (e.pointerId !== activePointer || e.button !== 0) return;
      activePointer = null;
      const point = hit(e),
        p = latest.current;
      if (drag) {
        const { type, id, object, position } = drag;
        const location = {
          x: Math.round(object.position.x),
          z: Math.round(object.position.z),
        };
        object.position.copy(position);
        drag = null;
        if (type === "building") p.onSelect(id);
        if (Math.hypot(e.clientX - startPixel.x, e.clientY - startPixel.y) >= 3 &&
            (location.x !== Math.round(position.x) || location.z !== Math.round(position.z)))
          p.onMove(type, id, location);
      } else if (
        !touchGesture && point && Math.hypot(e.clientX - startPixel.x, e.clientY - startPixel.y) < 5
      ) {
        if (p.v.tool === "draw" || p.v.tool === "draw-path")
          p.onDraw({ x: Math.round(point.x), z: Math.round(point.z) });
        else {
          const hits = ray.intersectObjects(content.children, true);
          for (const h of hits) {
            let a: T.Object3D | null = h.object;
            while (a && a !== content && !a.userData.type) a = a.parent;
            if (a?.userData.type === "stall" && p.v.tool === "erase") {
              p.onErase(a.userData.id);
              break;
            }
            if (a?.userData.type === "building") {
              p.onSelect(a.userData.id);
              break;
            }
          }
        }
      }
      controls.enabled = true;
      renderer.domElement.style.cursor = idleCursor();
      if (renderer.domElement.hasPointerCapture(e.pointerId))
        renderer.domElement.releasePointerCapture(e.pointerId);
    };
    const cancel = () => {
      if (drag) drag.object.position.copy(drag.position);
      drag = null;
      activePointer = null;
      controls.enabled = true;
      renderer.domElement.style.cursor = idleCursor();
    };
    // Choose editing before OrbitControls receives the same press.
    renderer.domElement.addEventListener("pointerdown", down, true);
    renderer.domElement.addEventListener("pointermove", move);
    renderer.domElement.addEventListener("pointerup", up);
    renderer.domElement.addEventListener("pointercancel", cancel);
    const recovery = watchPointerRecovery(renderer.domElement, window, document, cancel);
    engine.current.cancelInteraction = recovery.cancel;
    latest.current.onExportReady(async () => {
      const g = content.clone(true);
      g.children
        .filter((o) => o.userData.editorOnly)
        .forEach((o) => g.remove(o));
      g.scale.setScalar(0.3048);
      g.updateMatrixWorld(true);
      const data = await new GLTFExporter().parseAsync(g, { binary: true });
      download(
        new Blob([data as ArrayBuffer], { type: "model/gltf-binary" }),
        "parking-model.glb",
      );
    });
    return () => {
      recovery.dispose();
      cancelAnimationFrame(frame);
      observer.disconnect();
      controls.dispose();
      dispose(content);
      renderer.dispose();
      renderer.domElement.remove();
      engine.current = null;
    };
  }, []);
  useEffect(() => {
    const e = engine.current;
    if (!e) return;
    const { s, v } = props;
    e.cancelInteraction?.();
    const reset = e.previousFit !== v.fit || e.previousMode !== s.mode;
    if (e.previousTop === false && v.top)
      e.savedPerspective = { position: e.camera.position.clone(), target: e.controls.target.clone() };
    const b = bounds(s.boundary);
    const height = Math.max(0, ...s.buildings.map(b => b.height), s.mode === "garage" ? (s.levels-1)*(s.floorHeight+v.explode)+5 : 0);
    const slopeMargin = Math.max(...s.boundary.map(p => Math.abs((p.x*s.slopeX+p.z*s.slopeZ)/100)));
    const target = new T.Vector3((b.minX+b.maxX)/2, height/2, (b.minZ+b.maxZ)/2);
    e.controls.minPolarAngle = v.top ? 0 : 0.08;
    e.controls.enableRotate = !v.top;
    e.controls.zoomToCursor = v.top;
    if (!v.top && e.previousTop === true && e.savedPerspective && !reset) {
      e.camera.position.copy(e.savedPerspective.position);
      e.controls.target.copy(e.savedPerspective.target);
    } else {
      const direction = v.top ? new T.Vector3(0,1,0.00001).normalize() : new T.Vector3(1,1.05,1).normalize();
      e.camera.position.copy(target).add(direction);
      e.camera.lookAt(target);
      const inverse = e.camera.quaternion.clone().invert();
      const corners: T.Vector3[] = [];
      for (const x of [b.minX,b.maxX]) for (const y of [-slopeMargin,height+slopeMargin]) for (const z of [b.minZ,b.maxZ])
        corners.push(new T.Vector3(x,y,z).sub(target).applyQuaternion(inverse));
      const distance = fitDistance(corners,e.camera.fov,e.camera.aspect);
      e.controls.maxDistance = Math.max(4500,distance*2);
      e.camera.far = Math.max(5000,distance*4);
      e.camera.updateProjectionMatrix();
      e.camera.position.copy(target).addScaledVector(direction,distance);
      e.controls.target.copy(target);
    }
    e.controls.update();
    e.previousTop = v.top; e.previousFit = v.fit; e.previousMode = s.mode;
  }, [props.v.top, props.s.mode, props.v.fit]);
  useEffect(() => {
    const e = engine.current;
    if (!e || !props.v.zoom.id) return;
    e.cancelInteraction?.();
    const offset = e.camera.position.clone().sub(e.controls.target);
    offset.setLength(zoomDistance(offset.length(),props.v.zoom.direction,e.controls.minDistance,e.controls.maxDistance));
    e.camera.position.copy(e.controls.target).add(offset);
    e.controls.update();
  }, [props.v.zoom]);
  useEffect(() => {
    const e = engine.current;
    if (!e) return;
    const { s, r, v } = props;
    e.cancelInteraction?.();
    dispose(e.content);
    e.content.clear();
    const root = e.content;
    const slope = (p: Point) =>
      s.mode === "surface" ? (p.x * s.slopeX + p.z * s.slopeZ) / 100 : 0;
    const b = bounds(s.boundary),
      clip = v.section
        ? [new T.Plane(new T.Vector3(0, 0, -1), center(s.boundary).z)]
        : [];
    e.renderer.clippingPlanes = clip;
    e.controls.enabled = true;
    e.controls.mouseButtons.LEFT = v.tool === "orbit" && !v.top && v.navigation === "orbit" ? T.MOUSE.ROTATE : T.MOUSE.PAN;
    e.controls.mouseButtons.RIGHT = T.MOUSE.PAN;
    e.controls.touches.ONE = v.tool === "orbit" && !v.top && v.navigation === "orbit" ? T.TOUCH.ROTATE : T.TOUCH.PAN;
    e.controls.touches.TWO = T.TOUCH.DOLLY_PAN;
    e.renderer.domElement.style.cursor = v.tool === "orbit" ? "grab" :
      ["boundary", "building", "edit-path"].includes(v.tool) ? "move" : "crosshair";
    function mesh(
      poly: Point[],
      height: number,
      color: string,
      thickness = 0,
      parent: T.Object3D = root,
      holes: Point[][] = [],
    ) {
      const shape = new T.Shape(poly.map((p) => new T.Vector2(p.x, -p.z)));
      holes.forEach((h) =>
        shape.holes.push(new T.Path(h.map((p) => new T.Vector2(p.x, -p.z)))),
      );
      const geometry = thickness
        ? new T.ExtrudeGeometry(shape, {
            depth: thickness,
            bevelEnabled: false,
          })
        : new T.ShapeGeometry(shape);
      geometry.rotateX(-Math.PI / 2);
      const positions = geometry.attributes.position;
      for (let i = 0; i < positions.count; i++)
        positions.setY(
          i,
          positions.getY(i) +
            height +
            slope({ x: positions.getX(i), z: positions.getZ(i) }),
        );
      geometry.computeVertexNormals();
      const m = new T.Mesh(
        geometry,
        new T.MeshStandardMaterial({
          color,
          side: T.DoubleSide,
          roughness: 0.88,
        }),
      );
      m.receiveShadow = true;
      m.castShadow = thickness > 0;
      parent.add(m);
      return m;
    }
    function line(
      poly: Point[],
      height: number,
      color: string,
      parent: T.Object3D = root,
      close = true,
    ) {
      const pts = close ? [...poly, poly[0]] : poly;
      const m = new T.Line(
        new T.BufferGeometry().setFromPoints(
          pts.map((p) => new T.Vector3(p.x, height + slope(p), p.z)),
        ),
        new T.LineBasicMaterial({ color }),
      );
      parent.add(m);
      return m;
    }
    function box(
      w: number,
      h: number,
      d: number,
      x: number,
      y: number,
      z: number,
      color: string,
      parent: T.Object3D = root,
    ) {
      const m = new T.Mesh(
        new T.BoxGeometry(w, h, d),
        new T.MeshStandardMaterial({ color, roughness: 0.8 }),
      );
      m.position.set(x, y, z);
      m.castShadow = true;
      m.receiveShadow = true;
      parent.add(m);
      return m;
    }
    function label(text: string, p: Point, y: number) {
      const canvas = document.createElement("canvas");
      canvas.width = 512;
      canvas.height = 80;
      const ctx = canvas.getContext("2d")!;
      ctx.fillStyle = "#f8fcffef";
      ctx.fillRect(0, 0, 512, 80);
      ctx.fillStyle = "#253d49";
      ctx.textAlign = "center";
      ctx.font = "36px Arial";
      ctx.fillText(text, 256, 52);
      const sprite = new T.Sprite(
        new T.SpriteMaterial({
          map: new T.CanvasTexture(canvas),
          depthTest: false,
        }),
      );
      sprite.position.set(p.x, y, p.z);
      sprite.scale.set(44, 7, 1);
      sprite.userData.editorOnly = true;
      root.add(sprite);
    }
    mesh(
      rectangle(
        b.maxX - b.minX + 130,
        b.maxZ - b.minZ + 130,
        (b.maxX + b.minX) / 2,
        (b.maxZ + b.minZ) / 2,
      ),
      -1.3,
      "#eeede7",
    );
    mesh(s.boundary, -0.4, "#d5ddce");
    line(s.boundary, 0.18, "#d89752");
    if (s.mode === "garage" && r.floor.length) {
      for (let l = 0; l < r.levelCount; l++) {
        if (v.level >= 0 && v.level !== l) continue;
        const y = l * (s.floorHeight + v.explode);
        mesh(
          r.floor,
          y - 0.8,
          "#adb9bc",
          0.6,
          root,
          l > 0 && r.ramps.length ? [r.ramps[0].poly] : [],
        );
        if (v.dimensions)
          label(
            `LEVEL ${l + 1} · ${r.stalls.filter((p) => p.level === l).length} SPACES`,
            { x: b.maxX + 25, z: 0 },
            y + 2,
          );
      }
    }
    for (let l = 0; l < r.levelCount; l++) {
      if (v.level >= 0 && v.level !== l) continue;
      const y = l * (s.floorHeight + v.explode);
      for (const a of r.aisles) mesh(a.poly, y + 0.02, "#989fa7");
    }
    if (r.entrance) mesh(r.entrance.poly, 0.04, "#b9d7a2");
    for (const [i, p] of r.stalls.entries()) {
      if (v.level >= 0 && v.level !== p.level) continue;
      const y = p.level * (s.floorHeight + v.explode),
        c = center(p.poly);
      const base = mesh(
        p.poly,
        y + 0.05,
        p.kind === "standard"
          ? "#a3a9b0"
          : p.kind === "accessible"
            ? "#3976a0"
            : p.kind === "ev"
              ? "#547c61"
              : "#857969",
      );
      base.userData = { type: "stall", id: p.id };
      line(p.poly, y + 0.12, colors[p.kind]);
      if (p.access) {
        mesh(p.access, y + 0.055, "#4d7591");
        line(p.access, y + 0.13, "#9fc9e1");
        const a = p.access;
        for (let t = 0.12; t < 1; t += 0.16) {
          line(
            [
              {
                x: a[0].x + (a[3].x - a[0].x) * t,
                z: a[0].z + (a[3].z - a[0].z) * t,
              },
              {
                x: a[1].x + (a[2].x - a[1].x) * Math.min(1, t + 0.15),
                z: a[1].z + (a[2].z - a[1].z) * Math.min(1, t + 0.15),
              },
            ],
            y + 0.14,
            "#c4dded",
            root,
            false,
          );
        }
      }
      if (
        v.cars &&
        i % 4 !== 0 &&
        i % Math.max(1, Math.ceil(r.stalls.length / 500)) === 0
      ) {
        const car = new T.Group();
        car.position.set(c.x, y + slope(c), c.z);
        const front = center([p.poly[0], p.poly[1]]),
          rear = center([p.poly[2], p.poly[3]]);
        car.rotation.y = Math.atan2(rear.x - front.x, rear.z - front.z);
        box(
          6,
          2.5,
          13,
          0,
          1.4,
          0,
          ["#dee5e7", "#294859", "#a6bbb8", "#c58e73"][i % 4],
          car,
        );
        box(5.4, 1.4, 6, 0, 3.1, 0, "#365364", car);
        root.add(car);
      }
    }
    for (const building of s.buildings) {
      const g = new T.Group();
      g.position.set(building.x, slope(building), building.z);
      g.rotation.y = (-building.rotation * Math.PI) / 180;
      g.userData = { type: "building", id: building.id };
      box(
        building.w,
        building.height,
        building.d,
        0,
        building.height / 2,
        0,
        building.id === v.selected ? "#f0f4e5" : "#e3e9e8",
        g,
      );
      box(
        building.w + 1,
        0.7,
        building.d + 1,
        0,
        building.height,
        0,
        "#f5f8f6",
        g,
      );
      for (let y = 5; y < building.height - 3; y += 10)
        box(
          building.w - 0.3,
          4,
          0.2,
          0,
          y,
          building.d / 2 + 0.15,
          "#6e8e9c",
          g,
        );
      root.add(g);
    }
    if (r.loading) {
      mesh(r.loading.poly, 0.1, "#b99a63");
      line(r.loading.poly, 0.15, "#f0d09b");
      if (v.dimensions) label("LOADING 14 × 40", center(r.loading.poly), 2);
    }
    r.columns.forEach((p) => {
      for (let l = 0; l < r.levelCount - 1; l++) {
        if (v.level >= 0 && v.level !== l) continue;
        box(
          2,
          s.floorHeight,
          2,
          p.x,
          l * (s.floorHeight + v.explode) + s.floorHeight / 2,
          p.z,
          "#bdc9c9",
        );
      }
    });
    r.ramps.forEach((ramp) => {
      const l = ramp.level ?? 0;
      if (v.level >= 0 && v.level !== l && v.level !== l + 1) return;
      const p = ramp.poly,
        y = l * (s.floorHeight + v.explode);
      const rise = s.floorHeight + v.explode,
        pts = p.map((a, i) => new T.Vector3(a.x, y + (i >= 2 ? rise : 0), a.z));
      const g = new T.BufferGeometry().setFromPoints([
        pts[0],
        pts[1],
        pts[2],
        pts[0],
        pts[2],
        pts[3],
      ]);
      g.computeVertexNormals();
      const m = new T.Mesh(
        g,
        new T.MeshStandardMaterial({ color: "#c2ab81", side: T.DoubleSide }),
      );
      root.add(m);
      if (v.dimensions)
        label(`${s.rampSlope}% RAMP`, center(p), y + rise / 2 + 4);
    });
    if (v.tool === "boundary") {
      s.boundary.forEach((p, i) => {
        const m = new T.Mesh(
          new T.SphereGeometry(2.5, 12, 8),
          new T.MeshBasicMaterial({ color: "#368cce", depthTest: false }),
        );
        m.position.set(p.x, slope(p) + 2, p.z);
        m.userData = { type: "vertex", id: String(i), editorOnly: true };
        m.renderOrder = 10;
        root.add(m);
      });
    }
    if (
      s.layoutMode === "paths" &&
      s.mode === "surface" &&
      (v.tool === "edit-path" || v.tool === "draw-path")
    ) {
      for (const path of s.paths ?? []) {
        const l = line(
          samplePath(path),
          0.35,
          path.id === v.selectedPath ? "#238bd0" : "#6eaccc",
          root,
          false,
        );
        l.userData.editorOnly = true;
        if (v.tool === "edit-path" && path.id === v.selectedPath)
          path.points.forEach((p, i) => {
            const m = new T.Mesh(
              new T.SphereGeometry(2.5, 12, 8),
              new T.MeshBasicMaterial({ color: "#238bd0", depthTest: false }),
            );
            m.position.set(p.x, slope(p) + 2, p.z);
            m.userData = {
              type: "path-node",
              id: JSON.stringify([path.id, i]),
              editorOnly: true,
            };
            m.renderOrder = 11;
            root.add(m);
          });
      }
    }
    if (v.draft.length) {
      line(v.draft, 0.5, "#fbba61", root, false).userData.editorOnly = true;
      v.draft.forEach((p) => {
        const m = box(2, 2, 2, p.x, 1, p.z, "#ffcc82");
        m.userData.editorOnly = true;
      });
    }
    if (v.dimensions) {
      s.boundary.forEach((p, i) => {
        const q = s.boundary[(i + 1) % s.boundary.length];
        label(
          `${Math.hypot(q.x - p.x, q.z - p.z).toFixed(0)} ft`,
          { x: (p.x + q.x) / 2, z: (p.z + q.z) / 2 },
          slope(p) + 5,
        );
      });
    }
    if (v.turn.enabled) {
      const study = turningStudy(s, r, v.turn);
      study.samples.forEach(
        (p, i) =>
          (line(
            p,
            0.6,
            i % 6 === 0 ? "#ea8753" : "#d9ae78",
          ).userData.editorOnly = true),
      );
      label(
        `${study.conflicts} / 25 samples conflict`,
        { x: v.turn.x, z: v.turn.z },
        8,
      );
    }
  }, [props.s, props.r, props.v.top, props.v.navigation, props.v.cars, props.v.dimensions,
    props.v.explode, props.v.section, props.v.level, props.v.tool,
    props.v.selected, props.v.draft, props.v.selectedPath, props.v.turn]);
  return (
    <div className="viewport" ref={host}>
      {error && (
        <p className="empty" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
