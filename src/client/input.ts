// Keyboard, mouse and gamepad. Gameplay edges (jump/swing/bunt presses) are
// latched until the next fixed tick consumes them, so no press is lost at any
// frame rate. Menu navigation is emitted as UI events.

export type UiEvent = "up" | "down" | "left" | "right" | "ok" | "back" | "start" | "cam" | "mute";

export interface GameInput {
  mx: number; mz: number; ay: number; ax: number;
  jumpHeld: boolean; jumpPressed: boolean; swingPressed: boolean; buntPressed: boolean; dashPressed: boolean;
}

const keys = new Set<string>();
let latchJump = false, latchSwing = false, latchBunt = false, latchDash = false;
let mouseL = false, mouseR = false;
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

const typing = () => {
  const a = document.activeElement as HTMLElement | null;
  return !!a && (a.tagName === "INPUT" || a.tagName === "TEXTAREA");
};

const GAME_KEYS = new Set(["KeyW", "KeyA", "KeyS", "KeyD", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Space", "KeyJ", "KeyK", "KeyQ", "KeyE", "KeyR", "KeyF", "KeyL", "ShiftLeft", "ShiftRight"]);

window.addEventListener("keydown", (e) => {
  if (typing()) {
    if (e.code === "Escape") (document.activeElement as HTMLElement).blur();
    if (e.code === "Enter") uiHandler("ok");
    return;
  }
  lastDevice = "kb";
  if (gameActive && GAME_KEYS.has(e.code)) e.preventDefault();
  if (!gameActive && (e.code === "Enter" || e.code === "NumpadEnter")) {
    e.preventDefault();
    if (!e.repeat) uiHandler("ok");
    return;
  }
  if (!e.repeat) {
    if (gameActive) {
      if (e.code === "Space") latchJump = true;
      if (e.code === "KeyJ" || e.code === "KeyL") latchSwing = true;
      if (e.code === "KeyK") latchBunt = true;
      if (e.code === "ShiftLeft" || e.code === "ShiftRight") latchDash = true;
    }
    if (e.code === "Escape") uiHandler("start");
    if (e.code === "KeyC") uiHandler("cam");
    if (e.code === "KeyM") uiHandler("mute");
    if (!gameActive) {
      if (e.code === "ArrowUp" || e.code === "KeyW") uiHandler("up");
      if (e.code === "ArrowDown" || e.code === "KeyS") uiHandler("down");
      if (e.code === "ArrowLeft" || e.code === "KeyA") uiHandler("left");
      if (e.code === "ArrowRight" || e.code === "KeyD") uiHandler("right");
      if (e.code === "Backspace") uiHandler("back");
    }
  }
  keys.add(e.code);
});
window.addEventListener("keyup", (e) => { keys.delete(e.code); });
window.addEventListener("blur", () => { keys.clear(); mouseL = mouseR = false; });

const canvas = document.getElementById("c") as HTMLCanvasElement;
canvas.addEventListener("mousedown", (e) => {
  if (!gameActive) return;
  lastDevice = "kb";
  if (e.button === 0) { latchSwing = true; mouseL = true; }
  if (e.button === 2) { latchBunt = true; mouseR = true; }
});
window.addEventListener("mouseup", (e) => { if (e.button === 0) mouseL = false; if (e.button === 2) mouseR = false; });
canvas.addEventListener("contextmenu", (e) => e.preventDefault());

// ------------------------------------------------------------------ gamepad

function deadzone(x: number, y: number, dz = 0.18): [number, number] {
  const m = Math.hypot(x, y);
  if (m < dz) return [0, 0];
  const k = Math.min(1, (m - dz) / (1 - dz)) / m;
  return [x * k, y * k];
}

let padMx = 0, padMz = 0, padAy = 0, padAx = 0, padJumpHeld = false;

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
  if (!gp) { padName = null; return; }
  padName = gp.id.replace(/\(.*?\)/g, "").trim() || "Gamepad";
  const b = (i: number) => !!gp.buttons[i]?.pressed || (gp.buttons[i]?.value ?? 0) > 0.5;
  const pressed = (i: number) => b(i) && !padPrev[i];
  let [lx, ly] = deadzone(gp.axes[0] ?? 0, gp.axes[1] ?? 0);
  if (b(14)) lx = -1; if (b(15)) lx = 1; if (b(12)) ly = -1; if (b(13)) ly = 1;
  const [rx, ry] = deadzone(gp.axes[2] ?? 0, gp.axes[3] ?? 0, 0.3);
  let any = Math.abs(lx) + Math.abs(ly) + Math.abs(ry) > 0;
  for (let i = 0; i < gp.buttons.length; i++) if (b(i)) any = true;
  if (any) lastDevice = "pad";

  padMx = lx; padMz = ly;
  padAy = -ry;   // right stick up = aim high
  padAx = rx;    // right stick sideways = curve
  padJumpHeld = b(0);

  if (gameActive) {
    if (pressed(0)) latchJump = true;
    if (pressed(4)) latchDash = true;
    if (pressed(2) || pressed(5) || pressed(7)) latchSwing = true;
    if (pressed(1) || pressed(6)) latchBunt = true;
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
  if (pressed(3)) uiHandler("cam");
  if (pressed(8)) uiHandler("mute");
  for (let i = 0; i < gp.buttons.length; i++) padPrev[i] = b(i);
}

export function rumble(strong: number, weak: number, ms: number) {
  if (lastDevice !== "pad") return;
  const gp = activePad() as (Gamepad & { vibrationActuator?: { playEffect: (t: string, o: object) => Promise<unknown> } }) | null;
  try { gp?.vibrationActuator?.playEffect("dual-rumble", { duration: ms, strongMagnitude: strong, weakMagnitude: weak }).catch(() => {}); } catch {}
}

/** Sample for one fixed tick; consumes press latches. Movement is world-space (camera faces -z). */
export function sampleInput(): GameInput {
  let kx = 0, kz = 0, kay = 0, kax = 0;
  if (!typing()) {
    if (keys.has("KeyA") || keys.has("ArrowLeft")) kx -= 1;
    if (keys.has("KeyD") || keys.has("ArrowRight")) kx += 1;
    if (keys.has("KeyW") || keys.has("ArrowUp")) kz -= 1;
    if (keys.has("KeyS") || keys.has("ArrowDown")) kz += 1;
    if (keys.has("KeyR")) kay += 1;   // aim high
    if (keys.has("KeyF")) kay -= 1;   // aim low
    if (keys.has("KeyQ")) kax -= 1;   // curve left
    if (keys.has("KeyE")) kax += 1;   // curve right
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
    jumpHeld: keys.has("Space") || padJumpHeld,
    jumpPressed: latchJump,
    swingPressed: latchSwing,
    buntPressed: latchBunt,
    dashPressed: latchDash,
  };
  latchJump = latchSwing = latchBunt = latchDash = false;
  void mouseL; void mouseR;
  return r;
}
