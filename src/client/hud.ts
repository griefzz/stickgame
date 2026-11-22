import * as THREE from "three";
import { SLOTS, SPEED_MAX, STOCKS, displaySpeed } from "../shared/constants";
import type { RosterEntry } from "../shared/protocol";
import { camera, clamp, reducedMotion } from "./render/scene";

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
      `<div class="weapon">${i === me ? "<b>You</b> · " : ""}${def.tag} · ${def.label}</div>` +
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

export function netInfo(ms: number, practice: boolean) {
  el.net.textContent = practice ? `PRACTICE · ${ms} ms` : `${ms} ms`;
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
  const f = b.speed / SPEED_MAX;
  el.fill.style.width = `${(f * 100).toFixed(1)}%`;
  const oc = b.owner >= 0 ? SLOTS[b.owner].color : "#ffffff";
  if (oc !== lastOwner) { document.documentElement.style.setProperty("--own", oc); lastOwner = oc; }
  el.owner.textContent = b.owner >= 0 ? names[b.owner] || SLOTS[b.owner].tag : "Neutral";
  el.freeze.textContent = (b.frozen ? b.freezeLeft : b.lastFreeze).toFixed(2);
  el.rally.textContent = String(b.hits);
  const hot = f >= 0.68 && b.on;
  el.panel.classList.toggle("hot", hot && !reducedMotion);
  el.panel.classList.toggle("charging", b.frozen && b.lastFreeze > 0.14);
  el.label.textContent = hot ? "Overclocked" : "Ball speed";
  const ch = b.frozen && b.lastFreeze > 0.14 ? 0.15 + 0.5 * f : 0;
  el.charge.style.opacity = String(reducedMotion ? ch * 0.4 : ch);

  players.forEach((p, i) => {
    const c = cards[i];
    if (!c) return;
    let st = "Ready", cls = "";
    if (p.gone) { st = "Left"; cls = "is-out"; }
    else if (p.out) { st = "Out"; cls = "is-out"; }
    else if (!p.alive) { st = "K.O."; cls = "is-ko"; }
    else if (b.hitstop && b.hitter === i) { st = "Swing"; cls = "is-swing"; }
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
