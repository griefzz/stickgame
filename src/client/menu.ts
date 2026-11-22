import { NAME_MAX, SLOTS } from "../shared/constants";
import type { RosterEntry } from "../shared/protocol";
import { sfx } from "./audio";
import type { UiEvent } from "./input";

export type Screen = "title" | "queue" | "pause" | "results" | "none";

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

const screens: Record<Exclude<Screen, "none">, HTMLElement> = {
  title: $("scrTitle"),
  queue: $("scrQueue"),
  pause: $("scrPause"),
  results: $("scrResults"),
};

const ADJ = ["NEON", "TURBO", "HYPER", "IRON", "VOLT", "LUCKY", "RAPID", "COSMIC", "PIXEL", "ROGUE", "SONIC", "ATOMIC"];
const NOUN = ["FOX", "COMET", "RACKET", "VIPER", "ORBIT", "SPARK", "BISON", "LYNX", "ROCKET", "FALCON", "DRIFT", "NOVA"];
function randomName() {
  return `${ADJ[Math.floor(Math.random() * ADJ.length)]}${NOUN[Math.floor(Math.random() * NOUN.length)]}`.slice(0, NAME_MAX);
}

export class Menu {
  screen: Screen = "title";
  nameEl = $<HTMLInputElement>("nameInput");
  statusEl = $("netStatus");
  onlineEl = $("onlineCount");
  findBtn = $<HTMLButtonElement>("btnFind");
  practiceBtn = $<HTMLButtonElement>("btnPractice");
  queueCount = $("queueCount");
  queueNames = $("queueNames");
  queueInfo = $("queueInfo");
  queueTime = $("queueTime");
  camBtn = $<HTMLButtonElement>("btnCam");
  soundBtn = $<HTMLButtonElement>("btnSound");
  resultList = $("resultList");
  resultHead = $("resultHead");
  againBtn = $<HTMLButtonElement>("btnAgain");
  padEl = $("padStatus");
  queuedAt = 0;
  connected = false;
  botsPref = true;
  matchSize = 4;
  botToggles = [$<HTMLButtonElement>("btnBots"), $<HTMLButtonElement>("btnBotsQ")];

  onFind = () => {};
  onPractice = () => {};
  onCancel = () => {};
  onResume = () => {};
  onLeave = () => {};
  onCam = () => {};
  onMute = () => {};
  onAgain = () => {};
  onMenu = () => {};
  onName = (_n: string) => {};
  onBots = (_on: boolean) => {};

  constructor() {
    let saved = "";
    try { saved = localStorage.getItem("oc.name") || ""; } catch {}
    try { this.botsPref = localStorage.getItem("oc.bots") !== "0"; } catch {}
    this.renderBots();
    for (const b of this.botToggles) {
      b.addEventListener("click", () => {
        this.botsPref = !this.botsPref;
        try { localStorage.setItem("oc.bots", this.botsPref ? "1" : "0"); } catch {}
        this.renderBots();
        this.onBots(this.botsPref);
      });
    }
    this.nameEl.maxLength = NAME_MAX;
    this.nameEl.value = saved || randomName();
    this.nameEl.addEventListener("change", () => this.commitName());
    this.nameEl.addEventListener("blur", () => this.commitName());
    $("btnShuffle").addEventListener("click", () => { this.nameEl.value = randomName(); this.commitName(); });
    this.findBtn.addEventListener("click", () => { this.commitName(); this.onFind(); });
    this.practiceBtn.addEventListener("click", () => { this.commitName(); this.onPractice(); });
    $("btnCancel").addEventListener("click", () => this.onCancel());
    $("btnResume").addEventListener("click", () => this.onResume());
    $("btnLeave").addEventListener("click", () => this.onLeave());
    this.camBtn.addEventListener("click", () => this.onCam());
    this.soundBtn.addEventListener("click", () => this.onMute());
    this.againBtn.addEventListener("click", () => this.onAgain());
    $("btnMenu").addEventListener("click", () => this.onMenu());
    document.querySelectorAll<HTMLElement>("#menu [data-nav]").forEach((b) => {
      b.addEventListener("mouseenter", () => this.setNavFocus(b, false));
    });
    this.show("title");
  }

  name(): string {
    const n = this.nameEl.value.normalize("NFKC").replace(/[^\p{L}\p{N} _.\-!?]/gu, "").replace(/\s+/g, " ").trim().slice(0, NAME_MAX);
    return n || "PLAYER";
  }

  commitName() {
    const n = this.name();
    this.nameEl.value = n;
    try { localStorage.setItem("oc.name", n); } catch {}
    this.onName(n);
  }

  show(s: Screen) {
    this.screen = s;
    $("menu").hidden = s === "none";
    $("menu").classList.toggle("overlay", s === "pause" || s === "results");
    for (const [k, el] of Object.entries(screens)) el.hidden = k !== s;
    if (s === "queue") this.queuedAt = performance.now();
    if (s !== "none") {
      const items = this.navItems();
      const first = items.find((e) => e.hasAttribute("data-autofocus")) ?? items[0];
      if (first) this.setNavFocus(first, false);
    }
  }

  navItems(): HTMLElement[] {
    if (this.screen === "none") return [];
    return [...screens[this.screen].querySelectorAll<HTMLElement>("[data-nav]")].filter((e) => !(e as HTMLButtonElement).disabled && e.offsetParent !== null);
  }

  setNavFocus(el: HTMLElement, sound = true) {
    document.querySelectorAll(".nav-focus").forEach((e) => e.classList.remove("nav-focus"));
    el.classList.add("nav-focus");
    if (el !== this.nameEl) el.focus({ preventScroll: true });
    if (sound) sfx.ui();
  }

  handleUi(e: UiEvent) {
    const items = this.navItems();
    const cur = items.findIndex((x) => x.classList.contains("nav-focus"));
    if (e === "up" || e === "left" || e === "down" || e === "right") {
      if (!items.length) return;
      const d = e === "up" || e === "left" ? -1 : 1;
      const next = items[(Math.max(0, cur) + d + items.length) % items.length];
      this.setNavFocus(next);
      return;
    }
    if (e === "ok") {
      const el = items[cur] ?? items[0];
      if (!el) return;
      if (el === this.nameEl) { this.nameEl.focus(); this.nameEl.select(); return; }
      sfx.ui();
      el.click();
      return;
    }
    if (e === "back" || e === "start") {
      if (this.screen === "queue") this.onCancel();
      else if (this.screen === "pause") this.onResume();
      else if (this.screen === "results") this.onMenu();
    }
  }

  setConnection(status: "connecting" | "open" | "closed") {
    this.connected = status === "open";
    this.statusEl.textContent = status === "open" ? "Connected" : status === "connecting" ? "Connecting to server…" : "Server offline · retrying";
    this.statusEl.className = "net " + status;
    this.findBtn.disabled = !this.connected;
    this.practiceBtn.disabled = !this.connected;
    if (this.connected && this.screen === "title" && document.activeElement !== this.nameEl) this.setNavFocus(this.findBtn, false);
  }

  notice(text: string) {
    const el = $("notice");
    el.textContent = text;
    el.hidden = false;
    clearTimeout(this.noticeTimer);
    this.noticeTimer = window.setTimeout(() => { el.hidden = true; }, 8000);
  }
  noticeTimer = 0;

  setOnline(on: number, q: number, m: number) {
    this.onlineEl.textContent = `${on} online · ${q} in queue · ${m} match${m === 1 ? "" : "es"} live`;
  }

  renderBots() {
    for (const b of this.botToggles) b.setAttribute("aria-checked", String(this.botsPref));
  }

  /** Server limits from the welcome message. bf = 0 means the server never fills with bots. */
  setServerCfg(size: number, bf: number) {
    this.matchSize = size;
    for (const b of this.botToggles) b.hidden = !bf;
  }

  /** bf: bots that would fill if the lobby launched now; bo: -1 server off, 0 someone opted out, 1 all allow. */
  setQueue(n: number, min: number, max: number, sIn: number, names: string[], bf: number, bo: number) {
    this.queueCount.textContent = `${n} / ${max}`;
    const empty = Math.max(0, max - names.length);
    this.queueNames.innerHTML = names.map((x) => `<li>${esc(x)}</li>`).join("") +
      Array.from({ length: empty }, (_, i) => `<li class="empty${i < bf ? " bot" : ""}"></li>`).join("");
    const plural = (k: number, w: string) => `${k} ${w}${k === 1 ? "" : "s"}`;
    let info: string;
    if (n >= max) info = "Lobby full · launching";
    else if (sIn >= 0) {
      info = `Launching in ${sIn}s · ` + (bf > 0
        ? `${plural(bf, "bot")} will fill the empty seat${bf === 1 ? "" : "s"} unless more players join`
        : bo === 0 ? "humans only (a player in this lobby has bots off)" : "more players can still join");
    } else info = `Waiting for ${plural(min - n, "more player")}`;
    this.queueInfo.textContent = info;
  }

  tick() {
    if (this.screen === "queue") {
      const s = Math.floor((performance.now() - this.queuedAt) / 1000);
      this.queueTime.textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
    }
  }

  setPad(name: string | null, active: boolean) {
    this.padEl.textContent = name ? `${name.slice(0, 32)} connected` : "No controller · press any button to connect";
    this.padEl.classList.toggle("on", !!name);
    document.body.classList.toggle("pad", active);
  }

  setCamLabel(l: string) { this.camBtn.querySelector("b")!.textContent = l; }
  setSoundLabel(muted: boolean) { this.soundBtn.querySelector("b")!.textContent = muted ? "Off" : "On"; }

  showResults(rank: number[], winner: number, roster: (RosterEntry | null)[], me: number, practice: boolean) {
    const place = rank.indexOf(me) + 1;
    const ord = (n: number) => n + (n === 1 ? "st" : n === 2 ? "nd" : n === 3 ? "rd" : "th");
    this.resultHead.innerHTML = winner === me
      ? `<span class="big win">Victory</span><span class="sub">You won the set</span>`
      : `<span class="big">${ord(place)} place</span><span class="sub">${esc(roster[winner]?.n ?? "")} won the set</span>`;
    this.resultList.innerHTML = rank.map((s, i) => {
      const r = roster[s];
      if (!r) return "";
      return `<li style="--c:${SLOTS[s].color}" class="${s === me ? "me" : ""}"><span class="pl">${i + 1}</span><span class="nm">${esc(r.n)}</span><span class="tg">${SLOTS[s].tag}</span></li>`;
    }).join("");
    this.againBtn.textContent = practice ? "Practice again" : "Find another match";
    this.show("results");
  }
}
