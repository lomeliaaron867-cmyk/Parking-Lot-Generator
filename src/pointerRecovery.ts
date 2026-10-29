// Cancel both editor drags and OrbitControls through their public DOM events.
export function watchPointerRecovery(
  canvas: HTMLElement,
  windowTarget: EventTarget,
  documentTarget: EventTarget & { visibilityState: string },
  onCancel: () => void,
) {
  const pointers = new Set<number>();
  const cancelPointer = (id: number) => {
    if (!pointers.delete(id)) return;
    canvas.dispatchEvent(new PointerEvent("pointercancel", { pointerId: id }));
    if (canvas.hasPointerCapture(id)) canvas.releasePointerCapture(id);
  };
  const cancel = () => {
    for (const id of [...pointers]) cancelPointer(id);
    onCancel();
  };
  const down = (event: Event) => pointers.add((event as PointerEvent).pointerId);
  const up = (event: Event) => pointers.delete((event as PointerEvent).pointerId);
  const lost = (event: Event) => cancelPointer((event as PointerEvent).pointerId);
  const move = (event: Event) => {
    const e = event as PointerEvent;
    if (e.pointerType !== "touch" && e.buttons === 0) cancelPointer(e.pointerId);
  };
  const key = (event: Event) => { if ((event as KeyboardEvent).key === "Escape") cancel(); };
  const visibility = () => { if (documentTarget.visibilityState === "hidden") cancel(); };
  const listeners: [EventTarget, string, EventListener, boolean][] = [
    [canvas, "pointerdown", down, true],
    [canvas, "pointerup", up, true],
    [canvas, "pointercancel", up, true],
    [canvas, "lostpointercapture", lost, false],
    [canvas, "pointermove", move, true],
    [windowTarget, "blur", cancel, false],
    [windowTarget, "keydown", key, false],
    [documentTarget, "visibilitychange", visibility, false],
  ];
  listeners.forEach(([target, type, listener, capture]) => target.addEventListener(type, listener, capture));
  return {
    cancel,
    dispose() {
      cancel();
      listeners.forEach(([target, type, listener, capture]) => target.removeEventListener(type, listener, capture));
    },
  };
}
