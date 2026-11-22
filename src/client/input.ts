// Keyboard, mouse and gamepad. Gameplay edges (jump/swing/bunt presses) are
// latched until the next fixed tick consumes them, so no press is lost at any
// frame rate. Menu navigation is emitted as UI events. Gameplay buttons come from
// the player's bindings (binds.ts); menu navigation keys are fixed.
import { actionsForKb, allKbCodes, kbBinds, onBindsChange, padBinds, type Action } from "./binds";

export type UiEvent = "up" | "down" | "left" | "right" | "ok" | "back" | "start" | "cam" | "mute" | "full";

export interface GameInput {
  mx: number; mz: number; ay: number; ax: number;
  jumpHeld: boolean; jumpPressed: boolean; swingPressed: boolean; buntPressed: boolean; dashPressed: boolean;
  swingHeld: boolean;
}

const held = new Set<string>(); // keyboard codes and "Mouse0".."Mouse4" currently down
let latchJump = false, latchSwing = false, latchBunt = false, latchDash = false;
let uiHandler: (e: UiEvent) => void = () => {};
let gameActive = false;
export let lastDevice: "kb" | "pad" = "kb";
let padName: string | null = null;
const padPrev: boolean[] = [];
let navHold = { dir: "", next: 0 };

export function onUi(fn: (e: UiEvent) => void) { uiHandler = fn; }
export function setGameActive(v: boolean) {
  gameActive = v;
  if (!v) { latchJump = latchSwing = latchBunt = latchDash = false; }
}

// ------------------------------------------------------------------ rebinding capture

type Capture = { kind: "kb" | "pad"; cb: (v: string | number | null) => void };
let capture: Capture | null = null;
let swallowUp = "", swallowClick = false;
/**
 * The next key / mouse button (kind "kb") or controller button ("pad") goes to cb instead of
 * the game. cb(null) = cancelled (Esc, or Start on a controller); "" / -1 = cleared (Backspace).
 */
export function captureNext(kind: "kb" | "pad", cb: (v: string | number | null) => void) { capture = { kind, cb }; }
export function cancelCapture() { const c = capture; capture = null; c?.cb(null); }
export const capturing = () => !!capture;

const isText = (t: EventTarget | null) => t instanceof HTMLElement && (t.tagName === "INPUT" || t.tagName === "TEXTAREA");
const isUi = (t: EventTarget | null) => t instanceof Element && !!t.closest("button, input, select, textarea, a, label");
const typing = () => isText(document.activeElement);

let gameCodes = allKbCodes();
onBindsChange(() => { gameCodes = allKbCodes(); });

function press(code: string) {
  for (const a of actionsForKb(code)) {
    if (gameActive) {
      if (a === "jump") latchJump = true;
      else if (a === "swing") latchSwing = true;
      else if (a === "bunt") latchBunt = true;
      else if (a === "dash") latchDash = true;
    }
    if (a === "cam") uiHandler("cam");
    else if (a === "mute") uiHandler("mute");
  }
}

window.addEventListener("keydown", (e) => {
  if (capture) {
    e.preventDefault(); e.stopPropagation();
    if (e.repeat) return;
    const c = capture;
    swallowUp = e.code;
    const cancel = e.code === "Escape", clear = e.code === "Backspace" || e.code === "Delete";
    if (c.kind === "kb") { capture = null; c.cb(cancel ? null : clear ? "" : e.code); }
    else if (cancel || clear) { capture = null; c.cb(cancel ? null : -1); }
    return;
  }
  if (e.altKey && (e.code === "Enter" || e.code === "NumpadEnter")) {
    e.preventDefault();
    if (!e.repeat) uiHandler("full");
    return;
  }
  if (typing()) {
    if (e.code === "Escape") (document.activeElement as HTMLElement).blur();
    if (e.code === "Enter") uiHandler("ok");
    return;
  }
  lastDevice = "kb";
  if (gameActive && (gameCodes.has(e.code) || e.code.startsWith("Arrow") || e.code === "Space")) e.preventDefault();
  if (!gameActive && (e.code === "Enter" || e.code === "NumpadEnter")) {
    e.preventDefault();
    if (!e.repeat) uiHandler("ok");
    return;
  }
  if (!e.repeat) {
    press(e.code);
    if (e.code === "Escape") uiHandler("start");
    if (!gameActive) {
      if (e.code === "ArrowUp" || e.code === "KeyW") uiHandler("up");
      if (e.code === "ArrowDown" || e.code === "KeyS") uiHandler("down");
      if (e.code === "ArrowLeft" || e.code === "KeyA") uiHandler("left");
      if (e.code === "ArrowRight" || e.code === "KeyD") uiHandler("right");
      if (e.code === "Backspace") uiHandler("back");
    }
  }
  held.add(e.code);
}, true);
window.addEventListener("keyup", (e) => {
  held.delete(e.code);
  // The key that finished a rebind shouldn't also click the focused button (Space does on keyup).
  if (swallowUp && e.code === swallowUp) { swallowUp = ""; e.preventDefault(); e.stopPropagation(); }
}, true);
window.addEventListener("blur", () => { held.clear(); });

// ------------------------------------------------------------------ mouse
// The page owns the mouse: no image dragging, text selection, context menu, middle-click
// autoscroll or back/forward navigation from the side buttons.

window.addEventListener("mousedown", (e) => {
  if (e.button === 1 || e.button >= 3) e.preventDefault();
  const code = "Mouse" + e.button;
  if (capture) {
    if (capture.kind === "kb") {
      e.preventDefault(); e.stopPropagation();
      const c = capture;
      capture = null;
      if (e.button === 0) swallowClick = true;
      c.cb(code);
    }
    return;
  }
  if (isUi(e.target) || isText(document.activeElement)) return;
  if (gameActive) { lastDevice = "kb"; e.preventDefault(); }
  held.add(code);
  press(code);
}, true);
window.addEventListener("mouseup", (e) => {
  if (e.button >= 3) e.preventDefault();
  held.delete("Mouse" + e.button);
}, true);
window.addEventListener("click", (e) => {
  if (swallowClick) { swallowClick = false; e.preventDefault(); e.stopPropagation(); }
}, true);
window.addEventListener("auxclick", (e) => e.preventDefault(), true);
document.addEventListener("contextmenu", (e) => { if (!isText(e.target)) e.preventDefault(); });
document.addEventListener("dragstart", (e) => e.preventDefault());
document.addEventListener("selectstart", (e) => { if (!isText(e.target)) e.preventDefault(); });

// Hide the cursor in a match once the mouse sits still.
let idleTimer = 0;
window.addEventListener("mousemove", () => {
  document.body.classList.remove("cursor-idle");
  clearTimeout(idleTimer);
  idleTimer = window.setTimeout(() => document.body.classList.add("cursor-idle"), 1800);
});

// ------------------------------------------------------------------ gamepad

function deadzone(x: number, y: number, dz = 0.18): [number, number] {
  const m = Math.hypot(x, y);
  if (m < dz) return [0, 0];
  const k = Math.min(1, (m - dz) / (1 - dz)) / m;
  return [x * k, y * k];
}

let padMx = 0, padMz = 0, padAy = 0, padAx = 0, padJumpHeld = false, padSwingHeld = false;

function activePad(): Gamepad | null {
  const pads = navigator.getGamepads ? navigator.getGamepads() : [];
  let best: Gamepad | null = null;
  for (const p of pads) if (p && p.connected) { if (!best || p.timestamp > best.timestamp) best = p; }
  return best;
}

export function gamepadName(): string | null { return padName; }

export function pollPads(rt: number) {
  const gp = activePad();
  padMx = padMz = padAy = padAx = 0;
  padJumpHeld = false;
  padSwingHeld = false;
  if (!gp) { padName = null; return; }
  padName = gp.id.replace(/\(.*?\)/g, "").trim() || "Gamepad";
  const b = (i: number) => !!gp.buttons[i]?.pressed || (gp.buttons[i]?.value ?? 0) > 0.5;
  const pressed = (i: number) => b(i) && !padPrev[i];
  const save = () => { for (let i = 0; i < gp.buttons.length; i++) padPrev[i] = b(i); };
  const aHeld = (a: Action) => padBinds(a).some((i) => i >= 0 && b(i));
  const aPressed = (a: Action) => padBinds(a).some((i) => i >= 0 && pressed(i));

  if (capture) {
    for (let i = 0; i < gp.buttons.length; i++) {
      if (!pressed(i)) continue;
      lastDevice = "pad";
      if (i === 9) { cancelCapture(); break; }       // Start cancels
      if (capture.kind === "pad") { const c = capture; capture = null; c.cb(i); break; }
    }
    save();
    return;
  }

  let [lx, ly] = deadzone(gp.axes[0] ?? 0, gp.axes[1] ?? 0);
  if (b(14)) lx = -1; if (b(15)) lx = 1; if (b(12)) ly = -1; if (b(13)) ly = 1;
  const [rx, ry] = deadzone(gp.axes[2] ?? 0, gp.axes[3] ?? 0, 0.3);
  let any = Math.abs(lx) + Math.abs(ly) + Math.abs(ry) > 0;
  for (let i = 0; i < gp.buttons.length; i++) if (b(i)) any = true;
  if (any) lastDevice = "pad";

  padMx = lx; padMz = ly;
  padAy = -ry;   // right stick up = aim high
  padAx = rx;    // right stick sideways = curve
  padJumpHeld = aHeld("jump");
  padSwingHeld = aHeld("swing");

  if (gameActive) {
    if (aPressed("jump")) latchJump = true;
    if (aPressed("dash")) latchDash = true;
    if (aPressed("swing")) latchSwing = true;
    if (aPressed("bunt")) latchBunt = true;
  } else {
    if (pressed(0)) uiHandler("ok");
    if (pressed(1)) uiHandler("back");
    // Stick / d-pad navigation with key-repeat feel.
    const dir = ly < -0.6 ? "up" : ly > 0.6 ? "down" : lx < -0.6 ? "left" : lx > 0.6 ? "right" : "";
    if (dir && dir !== navHold.dir) { uiHandler(dir as UiEvent); navHold = { dir, next: rt + 0.38 }; }
    else if (dir && rt >= navHold.next) { uiHandler(dir as UiEvent); navHold.next = rt + 0.13; }
    else if (!dir) navHold.dir = "";
  }
  if (pressed(9)) uiHandler("start");
  if (aPressed("cam")) uiHandler("cam");
  if (aPressed("mute")) uiHandler("mute");
  save();
}

export function rumble(strong: number, weak: number, ms: number) {
  if (lastDevice !== "pad") return;
  const gp = activePad() as (Gamepad & { vibrationActuator?: { playEffect: (t: string, o: object) => Promise<unknown> } }) | null;
  try { gp?.vibrationActuator?.playEffect("dual-rumble", { duration: ms, strongMagnitude: strong, weakMagnitude: weak }).catch(() => {}); } catch {}
}

const down = (a: Action) => kbBinds(a).some((c) => c !== "" && held.has(c));

/** Sample for one fixed tick; consumes press latches. Movement is world-space (camera faces -z). */
export function sampleInput(): GameInput {
  let kx = 0, kz = 0, kay = 0, kax = 0;
  if (!typing()) {
    if (down("left")) kx -= 1;
    if (down("right")) kx += 1;
    if (down("up")) kz -= 1;
    if (down("down")) kz += 1;
    if (down("aimHigh")) kay += 1;
    if (down("aimLow")) kay -= 1;
    if (down("curveL")) kax -= 1;
    if (down("curveR")) kax += 1;
  }
  const km = Math.hypot(kx, kz);
  if (km > 1) { kx /= km; kz /= km; }
  let mx = kx + padMx, mz = kz + padMz;
  const m = Math.hypot(mx, mz);
  if (m > 1) { mx /= m; mz /= m; }
  const ay = Math.max(-1, Math.min(1, kay + padAy));
  const ax = Math.max(-1, Math.min(1, kax + padAx));
  const r: GameInput = {
    mx, mz, ay, ax,
    jumpHeld: down("jump") || padJumpHeld,
    jumpPressed: latchJump,
    swingPressed: latchSwing,
    buntPressed: latchBunt,
    dashPressed: latchDash,
    swingHeld: down("swing") || padSwingHeld,
  };
  latchJump = latchSwing = latchBunt = latchDash = false;
  return r;
}
