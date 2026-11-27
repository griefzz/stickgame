import * as THREE from "three";
import { OVERCLOCK_SPEED, SLOTS, STOCKS, displaySpeed, speedFeel, weaponOf } from "../shared/constants";
import type { RosterEntry } from "../shared/protocol";
import { camera, clamp, reducedMotion } from "./render/scene";
import { firstKb, firstPad, onBindsChange } from "./binds";

const $ = (id: string) => document.getElementById(id)!;
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

const el = {
  hud: $("hud"),
  panel: $("speedPanel"),
  num: $("speedNum"),
  fill: $("speedFill"),
  label: $("speedLabel"),
  owner: $("owner"),
  freeze: $("freeze"),
  freezeUnit: $("freezeUnit"),
  rally: $("rally"),
  charge: $("charge"),
  callouts: $("callouts"),
  tags: $("tags"),
  roster: $("roster"),
  banner: $("banner"),
  bBig: $("bannerBig"),
  bSmall: $("bannerSmall"),
  net: $("netinfo"),
  count: $("countdown"),
};

interface Card { el: HTMLElement; status: HTMLElement; pips: HTMLElement[]; last: string }
let cards: (Card | null)[] = [];
let tags: (HTMLElement | null)[] = [];
let names: string[] = [];
let disp = displaySpeed(15);
let lastNum = "", lastOwner = "";

export function hudShow(v: boolean) { el.hud.hidden = !v; }

export function hudSetup(roster: (RosterEntry | null)[], me: number) {
  el.roster.innerHTML = "";
  el.tags.innerHTML = "";
  el.callouts.innerHTML = "";
  el.banner.classList.remove("show");
  cards = [];
  tags = [];
  names = roster.map((r) => (r ? r.n : ""));
  const n = roster.filter(Boolean).length;
  el.roster.style.setProperty("--n", String(Math.max(2, n)));
  roster.forEach((r, i) => {
    if (!r) { cards.push(null); tags.push(null); return; }
    const def = SLOTS[i];
    const c = document.createElement("div");
    c.className = "card" + (i === me ? " is-me" : "");
    c.style.setProperty("--c", def.color);
    c.innerHTML = `<div class="name">${esc(r.n)}</div><div class="status">Ready</div>` +
      `<div class="weapon">${i === me ? "<b>You</b> · " : ""}${def.tag} · ${weaponOf(r.w).name}</div>` +
      `<div class="stocks" aria-label="Stocks">${'<i class="pip"></i>'.repeat(STOCKS)}</div>`;
    el.roster.appendChild(c);
    cards.push({ el: c, status: c.querySelector(".status")!, pips: [...c.querySelectorAll<HTMLElement>(".pip")], last: "" });
    const t = document.createElement("div");
    t.className = "tag" + (i === me ? " me" : "");
    t.style.setProperty("--c", def.color);
    t.textContent = i === me ? "YOU" : r.n;
    el.tags.appendChild(t);
    tags.push(t);
  });
}

const pv = new THREE.Vector3();
export function project(x: number, y: number, z: number) {
  pv.set(x, y, z).project(camera);
  return { x: ((pv.x + 1) / 2) * window.innerWidth, y: ((1 - pv.y) / 2) * window.innerHeight, behind: pv.z > 1 };
}

export function callout(x: number, y: number, z: number, text: string, sub: string, color: string) {
  const s = project(x, y, z);
  if (s.behind) return;
  const px = clamp(s.x, 90, window.innerWidth - 90), py = clamp(s.y - 40, 120, window.innerHeight - 160);
  const a = document.createElement("div");
  a.className = "callout";
  a.style.setProperty("--c", color);
  a.style.transform = `translate(${px}px, ${py}px)`;
  a.innerHTML = `<span class="in"><span class="t">${esc(text)}</span><span class="s">${esc(sub)}</span></span>`;
  el.callouts.appendChild(a);
  while (el.callouts.children.length > 4) el.callouts.firstChild!.remove();
  setTimeout(() => a.remove(), 1400);
}

export function banner(big: string, small: string, color: string) {
  el.banner.style.setProperty("--c", color);
  el.bBig.textContent = big;
  el.bSmall.textContent = small;
  el.banner.classList.remove("show");
  void el.banner.offsetWidth;
  el.banner.classList.add("show");
}

export function countdown(text: string | null) {
  if (!text) { el.count.hidden = true; return; }
  el.count.hidden = false;
  if (el.count.textContent !== text) {
    el.count.textContent = text;
    el.count.classList.remove("tick");
    void el.count.offsetWidth;
    el.count.classList.add("tick");
  }
}

export function netInfo(ms: number, label: string) {
  el.net.textContent = label ? `${label} · ${ms} ms` : `${ms} ms`;
  el.net.classList.toggle("bad", ms > 150);
}

export interface HudPlayer {
  present: boolean;
  alive: boolean;
  out: boolean;
  gone: boolean;
  stocks: number;
  ko: boolean;          // ragdoll in progress
  airborne: boolean;
  invuln: boolean;
  x: number; y: number; z: number;
  tagVisible: boolean;
}

export interface HudBall {
  on: boolean;
  speed: number;
  owner: number;
  frozen: boolean;
  hitstop: boolean;     // frozen on a hitter's bat (not a K.O. hold)
  charge: number;       // 0..1 while the hitter holds a charge
  freezeLeft: number;
  lastFreeze: number;
  hits: number;
  hitter: number;
  threat: number;       // slot the ball is heading for, or -1
}

export function hudUpdate(dt: number, b: HudBall, players: HudPlayer[]) {
  const target = displaySpeed(b.speed);
  disp += (target - disp) * (1 - Math.exp(-dt * 14));
  const n = String(Math.round(disp)).padStart(3, "0");
  if (n !== lastNum) { el.num.textContent = n; lastNum = n; }
  const f = speedFeel(b.speed);
  el.fill.style.width = `${(f * 100).toFixed(1)}%`;
  const oc = b.owner >= 0 ? SLOTS[b.owner].color : "#ffffff";
  if (oc !== lastOwner) { document.documentElement.style.setProperty("--own", oc); lastOwner = oc; }
  el.owner.textContent = b.owner >= 0 ? names[b.owner] || SLOTS[b.owner].tag : "Neutral";
  el.freeze.textContent = b.charge > 0 ? `${Math.round(b.charge * 100)}%` : (b.frozen ? b.freezeLeft : b.lastFreeze).toFixed(2);
  el.freezeUnit.hidden = b.charge > 0;
  el.rally.textContent = String(b.hits);
  const hot = b.speed >= OVERCLOCK_SPEED && b.on;
  el.panel.classList.toggle("hot", hot && !reducedMotion);
  el.panel.classList.toggle("charging", (b.frozen && b.lastFreeze > 0.14) || b.charge > 0);
  el.label.textContent = b.charge > 0 ? "Charging" : hot ? "Overclocked" : "Ball speed";
  const ch = (b.frozen && b.lastFreeze > 0.14) || b.charge > 0 ? 0.15 + 0.5 * f + 0.3 * b.charge : 0;
  el.charge.style.opacity = String(reducedMotion ? ch * 0.4 : ch);

  players.forEach((p, i) => {
    const c = cards[i];
    if (!c) return;
    let st = "Ready", cls = "";
    if (p.gone) { st = "Left"; cls = "is-out"; }
    else if (p.out) { st = "Out"; cls = "is-out"; }
    else if (!p.alive) { st = "K.O."; cls = "is-ko"; }
    else if (b.hitstop && b.hitter === i) { st = b.charge > 0 ? `Charge ${Math.round(b.charge * 100)}%` : "Swing"; cls = "is-swing"; }
    else if (b.on && b.threat === i) { st = "Incoming"; cls = "is-target"; }
    else if (p.invuln) st = "Shielded";
    else if (p.airborne) st = "Airborne";
    const key = st + cls + p.stocks;
    if (key !== c.last) {
      c.last = key;
      c.status.textContent = st;
      c.el.classList.remove("is-out", "is-ko", "is-swing", "is-target");
      if (cls) c.el.classList.add(cls);
      c.pips.forEach((pp, k) => pp.classList.toggle("lost", k >= p.stocks));
    }
    const t = tags[i];
    if (!t) return;
    if (!p.tagVisible) { t.style.display = "none"; return; }
    const s = project(p.x, p.y + 2.75, p.z);
    if (s.behind) { t.style.display = "none"; return; }
    t.style.display = "";
    t.style.transform = `translate(${s.x.toFixed(1)}px, ${s.y.toFixed(1)}px) translate(-50%, -100%)`;
  });
}

// ---------------------------------------------------------------- training timing meter
// The bar is a timeline of the swing: the left end is a swing that started long before the
// ball arrived, the right end a swing that started after the ball had gone past.

const tr = {
  panel: $("trainPanel"), res: $("trRes"), detail: $("trDetail"), mark: $("trMark"), ghosts: $("trGhosts"),
  stats: $("trStats"), keys: $("trKeys"), pfLabel: $("trPfLabel"),
  zEarly: $("trZEarly"), zGood: $("trZGood"), zPf: $("trZPf"), zLate: $("trZLate"),
};
const LEAD_EARLY = 400, LEAD_LATE = -150; // ms at the bar's left and right ends
const HIT_WINDOW = 200;                     // ms: a swing connects if the ball arrives this soon
let pfMs = 50;
let recent: number[] = [];
let st = { swings: 0, hits: 0, perfect: 0, streak: 0, best: 0 };

/** Bar position (percent from the left) for a swing that started `lead` ms before the ball arrived. */
const barPos = (lead: number) => ((LEAD_EARLY - Math.max(LEAD_LATE, Math.min(LEAD_EARLY, lead))) / (LEAD_EARLY - LEAD_LATE)) * 100;

function zone(e: HTMLElement, from: number, to: number) {
  const a = barPos(from), b = barPos(to);
  e.style.left = `${a}%`;
  e.style.width = `${b - a}%`;
}

function renderTrainKeys() {
  tr.keys.innerHTML = `<span class="kb-only"><b>${esc(firstKb("reset"))}</b> reset · <b>Esc</b> change arena</span>` +
    `<span class="pad-only"><b>${esc(firstPad("reset"))}</b> reset · <b>Start</b> change arena</span>`;
}
onBindsChange(renderTrainKeys);

/** Shows or hides the timing meter. perfect: the weapon's perfect window in seconds. */
export function trainSetup(on: boolean, perfect = 0.05, color = "#ffffff") {
  el.hud.classList.toggle("training", on);
  tr.panel.hidden = !on;
  if (!on) return;
  pfMs = Math.round(perfect * 1000);
  tr.panel.style.setProperty("--c", color);
  zone(tr.zEarly, LEAD_EARLY, HIT_WINDOW);
  zone(tr.zGood, HIT_WINDOW, pfMs);
  zone(tr.zPf, pfMs, 0);
  zone(tr.zLate, 0, LEAD_LATE);
  tr.pfLabel.style.left = `${barPos(pfMs / 2)}%`;
  recent = [];
  st = { swings: 0, hits: 0, perfect: 0, streak: 0, best: 0 };
  tr.ghosts.innerHTML = "";
  tr.mark.hidden = true;
  tr.res.textContent = "Timing";
  tr.res.className = "tr-res";
  tr.detail.textContent = `A swing that starts ${pfMs} ms or less before the ball reaches you is a perfect hit.`;
  tr.stats.textContent = "No swings yet";
  renderTrainKeys();
}

/** One smash's timing from the server (see Match.timing). */
export function trainResult(r: string, ms: number) {
  st.swings++;
  let lead: number | null = ms, big: string, cls: string, detail: string;
  if (r === "pf") {
    st.hits++; st.perfect++; st.streak++; st.best = Math.max(st.best, st.streak);
    big = "Perfect"; cls = "pf"; detail = `Contact ${ms} ms after you swung`;
  } else {
    st.streak = 0;
    if (r === "ok") {
      st.hits++;
      big = "Good"; cls = "ok"; detail = `Contact ${ms} ms after you swung. Swing ${Math.max(1, ms - pfMs)} ms later for a perfect.`;
    } else if (r === "early") {
      big = "Too early"; cls = "bad"; detail = `The ball arrived ${ms} ms after you swung`;
    } else if (r === "late") {
      lead = -ms; big = "Too late"; cls = "bad"; detail = `You swung ${ms} ms after the ball went past`;
    } else {
      lead = null; big = "Miss"; cls = "miss"; detail = "The ball didn't come near you";
    }
  }
  tr.res.textContent = big;
  tr.res.className = "tr-res " + cls;
  tr.detail.textContent = detail;
  if (lead !== null) {
    const x = barPos(lead);
    tr.mark.hidden = false;
    tr.mark.style.left = `${x}%`;
    tr.mark.classList.remove("pop");
    void tr.mark.offsetWidth;
    tr.mark.classList.add("pop");
    recent.push(x);
    if (recent.length > 8) recent.shift();
    tr.ghosts.innerHTML = recent.slice(0, -1).map((g) => `<i class="tr-ghost" style="left:${g.toFixed(1)}%"></i>`).join("");
  } else {
    // A miss has no timing, so the bar shows only the earlier swings.
    tr.mark.hidden = true;
    tr.ghosts.innerHTML = recent.map((g) => `<i class="tr-ghost" style="left:${g.toFixed(1)}%"></i>`).join("");
  }
  tr.stats.textContent = `${st.swings} swing${st.swings === 1 ? "" : "s"} · ${st.hits} hit${st.hits === 1 ? "" : "s"} · ${st.perfect} perfect` +
    (st.best > 1 ? ` · best streak ${st.best}` : "");
}

const specEl = document.getElementById("spectate")!;
let specKey = "";
/** "You're spectating" strip with the director-camera toggle hint. */
export function spectateHint(on: boolean, director: boolean) {
  const key = on ? (director ? "d" : "a") : "";
  if (key === specKey) return;
  specKey = key;
  specEl.hidden = !on;
  if (on) {
    specEl.innerHTML = `Spectating · director camera <b>${director ? "on" : "off"}</b> · ` +
      `<span class="kb-only">press <b>${firstKb("cam")}</b></span><span class="pad-only">press <b>${firstPad("cam")}</b></span> to switch`;
  }
}
