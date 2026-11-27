// Remappable controls. Keyboard/mouse bindings are KeyboardEvent.code values, or "Mouse0".."Mouse4"
// for mouse buttons; controller bindings are standard-mapping button indices. Each action has
// two slots of each kind. Saved per browser.

export type Action =
  | "up" | "down" | "left" | "right"
  | "jump" | "dash" | "swing" | "bunt"
  | "aimHigh" | "aimLow" | "curveL" | "curveR"
  | "reset" | "cam" | "mute";

export const ACTIONS: { id: Action; label: string; pad: boolean }[] = [
  { id: "up", label: "Move up", pad: false },
  { id: "down", label: "Move down", pad: false },
  { id: "left", label: "Move left", pad: false },
  { id: "right", label: "Move right", pad: false },
  { id: "jump", label: "Jump · double · off walls", pad: true },
  { id: "dash", label: "Air dash", pad: true },
  { id: "swing", label: "Swing · hold to charge", pad: true },
  { id: "bunt", label: "Bunt", pad: true },
  { id: "aimHigh", label: "Aim high", pad: false },
  { id: "aimLow", label: "Aim low", pad: false },
  { id: "curveL", label: "Curve left", pad: false },
  { id: "curveR", label: "Curve right", pad: false },
  { id: "reset", label: "Reset (training)", pad: true },
  { id: "cam", label: "Director camera (spectating)", pad: true },
  { id: "mute", label: "Mute", pad: true },
];

export const SLOTS = 2;
type Binds = { kb: Record<Action, string[]>; pad: Partial<Record<Action, number[]>> };

const DEFAULTS: Binds = {
  kb: {
    up: ["KeyW", "ArrowUp"], down: ["KeyS", "ArrowDown"], left: ["KeyA", "ArrowLeft"], right: ["KeyD", "ArrowRight"],
    jump: ["Space", ""], dash: ["ShiftLeft", "ShiftRight"], swing: ["KeyJ", "Mouse0"], bunt: ["KeyK", "Mouse2"],
    aimHigh: ["KeyR", ""], aimLow: ["KeyF", ""], curveL: ["KeyQ", ""], curveR: ["KeyE", ""],
    reset: ["KeyT", ""], cam: ["KeyC", ""], mute: ["KeyM", ""],
  },
  pad: { jump: [0, -1], dash: [4, -1], swing: [2, 7], bunt: [1, 6], reset: [5, -1], cam: [3, -1], mute: [8, -1] },
};

const clone = (b: Binds): Binds => JSON.parse(JSON.stringify(b));
let binds: Binds = load();
let listeners: (() => void)[] = [];

function load(): Binds {
  const b = clone(DEFAULTS);
  try {
    const s = JSON.parse(localStorage.getItem("oc.binds") || "null");
    if (s && typeof s === "object") {
      for (const a of ACTIONS) {
        const k = s.kb?.[a.id];
        if (Array.isArray(k)) b.kb[a.id] = Array.from({ length: SLOTS }, (_, i) => (typeof k[i] === "string" ? k[i] : ""));
        const p = s.pad?.[a.id];
        if (a.pad && Array.isArray(p)) b.pad[a.id] = Array.from({ length: SLOTS }, (_, i) => (Number.isInteger(p[i]) ? p[i] : -1));
      }
      // An action added after these binds were saved: drop any default the player already uses elsewhere.
      for (const a of ACTIONS) {
        if (!Array.isArray(s.kb?.[a.id])) {
          const used = new Set(ACTIONS.filter((x) => x.id !== a.id).flatMap((x) => b.kb[x.id]).filter(Boolean));
          b.kb[a.id] = b.kb[a.id].map((c) => (used.has(c) ? "" : c));
        }
        if (a.pad && !Array.isArray(s.pad?.[a.id])) {
          const used = new Set(ACTIONS.filter((x) => x.id !== a.id).flatMap((x) => b.pad[x.id] ?? []).filter((i) => i >= 0));
          b.pad[a.id] = (b.pad[a.id] ?? []).map((i) => (used.has(i) ? -1 : i));
        }
      }
    }
  } catch {}
  return b;
}
function save() {
  try { localStorage.setItem("oc.binds", JSON.stringify(binds)); } catch {}
  for (const f of listeners) f();
}

export function onBindsChange(f: () => void) { listeners.push(f); }
export const kbBinds = (a: Action) => binds.kb[a];
export const padBinds = (a: Action) => binds.pad[a] ?? [];

/** Binds code to an action's slot; the code is taken off any other action using it. */
export function setKb(a: Action, slot: number, code: string) {
  if (code) for (const x of ACTIONS) binds.kb[x.id] = binds.kb[x.id].map((c) => (c === code ? "" : c));
  binds.kb[a][slot] = code;
  save();
}
export function setPad(a: Action, slot: number, btn: number) {
  if (btn >= 0) for (const x of ACTIONS) if (binds.pad[x.id]) binds.pad[x.id] = binds.pad[x.id]!.map((c) => (c === btn ? -1 : c));
  const p = binds.pad[a] ?? [-1, -1];
  p[slot] = btn;
  binds.pad[a] = p;
  save();
}
export function resetBinds() { binds = clone(DEFAULTS); save(); }

/** Which actions a keyboard code / mouse button triggers. */
export function actionsForKb(code: string): Action[] {
  const out: Action[] = [];
  for (const a of ACTIONS) if (binds.kb[a.id].includes(code)) out.push(a.id);
  return out;
}
export function allKbCodes(): Set<string> {
  const s = new Set<string>();
  for (const a of ACTIONS) for (const c of binds.kb[a.id]) if (c) s.add(c);
  return s;
}

const NAMED: Record<string, string> = {
  Space: "Space", ShiftLeft: "L-Shift", ShiftRight: "R-Shift", ControlLeft: "L-Ctrl", ControlRight: "R-Ctrl",
  AltLeft: "L-Alt", AltRight: "R-Alt", MetaLeft: "L-Win", MetaRight: "R-Win", Tab: "Tab", CapsLock: "Caps",
  Enter: "Enter", Backspace: "Bksp", ArrowUp: "↑", ArrowDown: "↓", ArrowLeft: "←", ArrowRight: "→",
  Backquote: "`", Minus: "-", Equal: "=", BracketLeft: "[", BracketRight: "]", Backslash: "\\", Semicolon: ";",
  Quote: "'", Comma: ",", Period: ".", Slash: "/", Insert: "Ins", Delete: "Del", Home: "Home", End: "End",
  PageUp: "PgUp", PageDown: "PgDn", ContextMenu: "Menu", IntlBackslash: "\\",
  Mouse0: "Click", Mouse1: "M-Click", Mouse2: "R-Click", Mouse3: "Mouse 4", Mouse4: "Mouse 5",
};
export function keyLabel(code: string): string {
  if (!code) return "—";
  if (NAMED[code]) return NAMED[code];
  if (code.startsWith("Key")) return code.slice(3);
  if (code.startsWith("Digit")) return code.slice(5);
  if (code.startsWith("Numpad")) return "Num " + code.slice(6).replace("Add", "+").replace("Subtract", "-").replace("Multiply", "*").replace("Divide", "/").replace("Decimal", ".");
  return code.replace(/(Left|Right)$/, "");
}
const PAD = ["A", "B", "X", "Y", "LB", "RB", "LT", "RT", "Back", "Start", "LS", "RS", "D-Up", "D-Down", "D-Left", "D-Right", "Home"];
export const padLabel = (i: number) => (i < 0 ? "—" : PAD[i] ?? `Btn ${i}`);

/** "<kbd>J</kbd> <kbd>Click</kbd>" for an action's bindings. */
export function kbHtml(a: Action): string {
  const k = binds.kb[a].filter(Boolean);
  return k.length ? k.map((c) => `<kbd>${keyLabel(c)}</kbd>`).join(" ") : "<kbd>—</kbd>";
}
export function padHtml(a: Action): string {
  const p = padBinds(a).filter((i) => i >= 0);
  return p.length ? p.map((i) => `<kbd>${padLabel(i)}</kbd>`).join(" ") : "<kbd>—</kbd>";
}
/** Plain-text label of an action's first binding ("C", "Y"). */
export const firstKb = (a: Action) => keyLabel(binds.kb[a].find(Boolean) ?? "");
export const firstPad = (a: Action) => padLabel(padBinds(a).find((i) => i >= 0) ?? -1);
