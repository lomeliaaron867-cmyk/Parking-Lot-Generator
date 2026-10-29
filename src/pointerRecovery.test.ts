import assert from "node:assert/strict";
import { watchPointerRecovery } from "./pointerRecovery.ts";

class TestPointer extends Event {
  pointerId: number; buttons: number; pointerType: string;
  constructor(type: string, options: {pointerId:number; buttons?:number; pointerType?:string}) {
    super(type); this.pointerId=options.pointerId; this.buttons=options.buttons ?? 1; this.pointerType=options.pointerType ?? "mouse";
  }
}
Object.defineProperty(globalThis,"PointerEvent",{value:TestPointer,configurable:true});
class Canvas extends EventTarget {
  captured = new Set<number>();
  hasPointerCapture(id:number) { return this.captured.has(id); }
  releasePointerCapture(id:number) { this.captured.delete(id); }
}
const canvas=new Canvas(), win=new EventTarget(), doc=Object.assign(new EventTarget(),{visibilityState:"visible"});
const canceled:number[]=[];
canvas.addEventListener("pointercancel", e=>canceled.push((e as TestPointer).pointerId));
const recovery=watchPointerRecovery(canvas as unknown as HTMLElement,win,doc,()=>{});
function start(id:number) {canvas.captured.add(id);canvas.dispatchEvent(new TestPointer("pointerdown",{pointerId:id}));}
start(1); win.dispatchEvent(new Event("blur"));
assert.deepEqual(canceled,[1]); assert.equal(canvas.captured.size,0);
start(2); canvas.dispatchEvent(new TestPointer("pointermove",{pointerId:2,buttons:0}));
assert.deepEqual(canceled,[1,2]);
start(3); canvas.dispatchEvent(new TestPointer("lostpointercapture",{pointerId:3}));
assert.deepEqual(canceled,[1,2,3]);
start(4); const escape=Object.assign(new Event("keydown"),{key:"Escape"}); win.dispatchEvent(escape);
assert.deepEqual(canceled,[1,2,3,4]);
start(5); doc.visibilityState="hidden"; doc.dispatchEvent(new Event("visibilitychange"));
assert.deepEqual(canceled,[1,2,3,4,5]);
start(6); canvas.dispatchEvent(new TestPointer("pointerup",{pointerId:6})); win.dispatchEvent(new Event("blur"));
assert.deepEqual(canceled,[1,2,3,4,5]);
recovery.dispose(); start(7); win.dispatchEvent(new Event("blur"));
assert.deepEqual(canceled,[1,2,3,4,5]);
console.log("Pointer recovery checks passed: blur, released mouse, capture loss, Escape, visibility, cleanup.");
