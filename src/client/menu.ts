import { NAME_MAX, SLOTS, WEAPONS } from "../shared/constants";
import { ARENAS } from "../shared/arena";
import type { RoomState, RosterEntry } from "../shared/protocol";
import { sfx } from "./audio";
import { captureNext, type UiEvent } from "./input";
import {
  ACTIONS, SLOTS as BIND_SLOTS, kbBinds, kbHtml, keyLabel, onBindsChange, padBinds, padHtml, padLabel, resetBinds, setKb, setPad, type Action,
} from "./binds";

export type Screen = "title" | "queue" | "room" | "pause" | "results" | "controls" | "none";

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

const screens: Record<Exclude<Screen, "none">, HTMLElement> = {
  title: $("scrTitle"),
  queue: $("scrQueue"),
  room: $("scrRoom"),
  pause: $("scrPause"),
  results: $("scrResults"),
  controls: $("scrControls"),
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
  roomBtn = $<HTMLButtonElement>("btnRoom");
  joinBtn = $<HTMLButtonElement>("btnJoin");
  codeEl = $<HTMLInputElement>("codeInput");
  menuBtn = $<HTMLButtonElement>("btnMenu");
  room: RoomState | null = null;
  hadSavedName = false;
  weapon = 0;
  weaponBtn = $<HTMLButtonElement>("btnWeapon");
  roomStartBtn = $<HTMLButtonElement>("btnRoomStart");
  roomBotsBtn = $<HTMLButtonElement>("btnRoomBots");
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
  onRoomCreate = () => {};
  onRoomJoin = (_code: string) => {};
  onRoomLeave = () => {};
  onRoomStart = () => {};
  onRoomBots = (_on: boolean) => {};
  onWeapon = (_w: number) => {};
  onRoomArena = (_a: number) => {};
  roomArenaBtn = $<HTMLButtonElement>("btnRoomArena");
  roomWeaponBtn = $<HTMLButtonElement>("btnRoomWeapon");
  onFull = () => {};

  constructor() {
    let saved = "";
    try { saved = localStorage.getItem("oc.name") || ""; } catch {}
    this.hadSavedName = !!saved;
    try { this.botsPref = localStorage.getItem("oc.bots") !== "0"; } catch {}
    this.renderBots();
    try { const w = parseInt(localStorage.getItem("oc.weapon") ?? "0", 10); if (WEAPONS[w]) this.weapon = w; } catch {}
    this.renderWeapon();
    this.roomWeaponBtn.addEventListener("click", (e) => this.cycleWeapon((e.target as HTMLElement).id === "roomWeaponPrev" ? -1 : 1));
    this.roomArenaBtn.addEventListener("click", (e) => this.cycleRoomArena((e.target as HTMLElement).id === "roomArenaPrev" ? -1 : 1));
    this.weaponBtn.addEventListener("click", (e) => {
      const prev = (e.target as HTMLElement).id === "weaponPrev";
      this.cycleWeapon(prev ? -1 : 1);
    });
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
    this.roomBtn.addEventListener("click", () => { this.commitName(); this.onRoomCreate(); });
    const join = () => {
      const code = this.codeEl.value.toUpperCase().replace(/[^A-Z]/g, "").slice(0, 4);
      this.codeEl.value = code;
      if (code.length !== 4) { this.notice("Room codes are 4 letters"); this.codeEl.focus(); return; }
      this.commitName();
      this.onRoomJoin(code);
    };
    this.joinBtn.addEventListener("click", join);
    this.codeEl.addEventListener("input", () => { this.codeEl.value = this.codeEl.value.toUpperCase().replace(/[^A-Z]/g, "").slice(0, 4); });
    this.codeEl.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); e.stopPropagation(); join(); } });
    $("btnCopy").addEventListener("click", () => this.copyLink());
    this.roomStartBtn.addEventListener("click", () => this.onRoomStart());
    $("btnRoomLeave").addEventListener("click", () => this.onRoomLeave());
    this.roomBotsBtn.addEventListener("click", () => { if (this.room?.host) this.onRoomBots(!this.room.bots); });
    $("btnCancel").addEventListener("click", () => this.onCancel());
    $("btnResume").addEventListener("click", () => this.onResume());
    $("btnLeave").addEventListener("click", () => this.onLeave());
    this.camBtn.addEventListener("click", () => this.onCam());
    this.soundBtn.addEventListener("click", () => this.onMute());
    $("btnFull").addEventListener("click", () => this.onFull());
    $("btnFsCorner").addEventListener("click", () => this.onFull());
    this.againBtn.addEventListener("click", () => this.onAgain());
    $("btnMenu").addEventListener("click", () => this.onMenu());
    document.querySelectorAll<HTMLElement>("#menu [data-nav]").forEach((b) => {
      b.addEventListener("mouseenter", () => this.setNavFocus(b, false));
    });
    $("btnRemap").addEventListener("click", () => this.openControls());
    $("btnControls").addEventListener("click", () => this.openControls());
    $("btnBindReset").addEventListener("click", () => { resetBinds(); this.bindNote("Controls reset to the defaults."); });
    $("btnBindDone").addEventListener("click", () => this.closeControls());
    onBindsChange(() => this.renderControls());
    this.renderControls();
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
    this.hadSavedName = true;
    this.onName(n);
  }

  show(s: Screen) {
    this.screen = s;
    $("menu").hidden = s === "none";
    $("menu").classList.toggle("overlay", s === "pause" || s === "results" || (s === "controls" && this.controlsFrom === "pause"));
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
    // Left/right on the weapon picker changes the weapon instead of moving focus.
    if ((e === "left" || e === "right") && (document.activeElement === this.weaponBtn || document.activeElement === this.roomWeaponBtn)) { this.cycleWeapon(e === "left" ? -1 : 1); return; }
    if ((e === "left" || e === "right") && document.activeElement === this.roomArenaBtn) { this.cycleRoomArena(e === "left" ? -1 : 1); return; }
    if ((e === "up" || e === "down") && cur >= 0 && items[cur].dataset.row !== undefined) {
      // Bind table: up/down keeps the column.
      const r = +items[cur].dataset.row! + (e === "up" ? -1 : 1), c = +items[cur].dataset.col!;
      const row = items.filter((x) => x.dataset.row === String(r));
      if (row.length) {
        this.setNavFocus(row.reduce((a, x) => (Math.abs(+x.dataset.col! - c) < Math.abs(+a.dataset.col! - c) ? x : a)));
        return;
      }
      if (e === "down") { const after = items.slice(cur).find((x) => x.dataset.row === undefined); if (after) { this.setNavFocus(after); return; } }
    }
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
      else if (this.screen === "controls") this.closeControls();
    }
  }

  // ---------------------------------------------------------------- controls (remapping)

  controlsFrom: Screen = "title";

  openControls() {
    if (this.screen === "controls") return;
    this.controlsFrom = this.screen;
    this.bindNote();
    this.show("controls");
  }

  closeControls() {
    this.show(this.controlsFrom === "controls" || this.controlsFrom === "none" ? "title" : this.controlsFrom);
  }

  bindNote(text?: string) {
    $("bindInfo").textContent = text ?? "Pick a slot, then press the key, mouse button or controller button for it. A key can only do one thing, so it moves off anything else that had it.";
  }

  /** Controls card, in-match key hints and the remap table, from the current bindings. */
  renderControls() {
    const first = (a: Action) => `<kbd>${keyLabel(kbBinds(a).find(Boolean) ?? "")}</kbd>`;
    const row = (k: string, d: string) => `<dt>${k}</dt><dd>${d}</dd>`;
    $("ctlKb").innerHTML = [
      row(first("up") + first("left") + first("down") + first("right"), "Move"),
      row(kbHtml("jump"), "Jump · double · off walls"),
      row(kbHtml("dash"), "Air dash"),
      row(kbHtml("swing"), "Swing · hold to charge"),
      row(kbHtml("bunt"), "Bunt"),
      row(`${kbHtml("aimHigh")} / ${kbHtml("aimLow")}`, "Aim high / low"),
      row(`${kbHtml("curveL")} / ${kbHtml("curveR")}`, "Curve left / right"),
      row(`${kbHtml("mute")} <kbd>Esc</kbd>`, "Mute, menu"),
      row(kbHtml("cam"), "Director camera when spectating"),
      row("<kbd>Alt</kbd>+<kbd>Enter</kbd>", "Full screen"),
    ].join("");
    $("ctlPad").innerHTML = [
      row("<kbd>L-Stick</kbd>", "Move"),
      row(padHtml("jump"), "Jump · double · off walls"),
      row(padHtml("dash"), "Air dash"),
      row(padHtml("swing"), "Swing · hold to charge"),
      row(padHtml("bunt"), "Bunt"),
      row("<kbd>R-Stick</kbd>", "Aim high / low · curve"),
      row(`${padHtml("mute")} <kbd>Start</kbd>`, "Mute, menu"),
      row(padHtml("cam"), "Director camera when spectating"),
    ].join("");
    const b = (a: Action) => kbBinds(a).filter(Boolean).map((c) => `<b>${keyLabel(c)}</b>`).join("/") || "<b>—</b>";
    const p = (a: Action) => padBinds(a).filter((i) => i >= 0).map((i) => `<b>${padLabel(i)}</b>`).join("/") || "<b>—</b>";
    $("keysKb").innerHTML = `${b("swing")} swing (hold to charge) · ${b("bunt")} bunt · ${b("jump")} jump (again in air or on a wall) · ${b("dash")} air dash · hold ${b("aimHigh")}/${b("aimLow")} aim high/low · hold ${b("curveL")}/${b("curveR")} curve · <b>Esc</b> menu`;
    $("keysPad").innerHTML = `${p("swing")} swing (hold to charge) · ${p("bunt")} bunt · ${p("jump")} jump (again in air or on a wall) · ${p("dash")} air dash · <b>Right stick</b> aim + curve · <b>Start</b> menu`;

    // Remap table: action | key | alt key | pad | alt pad.
    const focused = document.querySelector<HTMLElement>("#bindTable .nav-focus");
    const fr = focused?.dataset.row, fc = focused?.dataset.col;
    const cells: string[] = ['<div class="bh"></div><div class="bh">Key</div><div class="bh">Alt key</div><div class="bh">Controller</div><div class="bh">Alt</div>'];
    ACTIONS.forEach((a, r) => {
      cells.push(`<div class="bl">${esc(a.label)}</div>`);
      for (let i = 0; i < BIND_SLOTS; i++) {
        const c = kbBinds(a.id)[i] ?? "";
        cells.push(`<button type="button" class="bind${c ? "" : " empty"}" data-nav data-row="${r}" data-col="${i}" data-a="${a.id}" data-k="kb" data-i="${i}">${esc(keyLabel(c))}</button>`);
      }
      if (a.pad) {
        for (let i = 0; i < BIND_SLOTS; i++) {
          const c = padBinds(a.id)[i] ?? -1;
          cells.push(`<button type="button" class="bind${c >= 0 ? "" : " empty"}" data-nav data-row="${r}" data-col="${2 + i}" data-a="${a.id}" data-k="pad" data-i="${i}">${esc(padLabel(c))}</button>`);
        }
      } else cells.push(`<div class="fixed">${a.id === "up" || a.id === "down" || a.id === "left" || a.id === "right" ? "Left stick" : "Right stick"}</div>`);
    });
    const table = $("bindTable");
    table.innerHTML = cells.join("");
    table.querySelectorAll<HTMLButtonElement>(".bind").forEach((el) => {
      el.addEventListener("mouseenter", () => this.setNavFocus(el, false));
      el.addEventListener("click", () => this.startCapture(el));
    });
    if (this.screen === "controls" && fr !== undefined) {
      const back = table.querySelector<HTMLElement>(`.bind[data-row="${fr}"][data-col="${fc}"]`);
      if (back) this.setNavFocus(back, false);
    }
  }

  startCapture(el: HTMLElement) {
    const a = el.dataset.a as Action, kind = el.dataset.k as "kb" | "pad", slot = +el.dataset.i!;
    el.classList.add("listening");
    el.textContent = "Press…";
    this.bindNote(kind === "kb"
      ? `${ACTIONS.find((x) => x.id === a)!.label}: press a key or mouse button. Esc cancels, Backspace clears.`
      : `${ACTIONS.find((x) => x.id === a)!.label}: press a controller button. Start cancels, Backspace clears.`);
    captureNext(kind, (v) => {
      if (v === null) { this.bindNote(); this.renderControls(); return; }
      if (kind === "kb") setKb(a, slot, v as string);
      else setPad(a, slot, v as number);
      this.bindNote();
      sfx.ui();
    });
  }

  setConnection(status: "connecting" | "open" | "closed") {
    this.connected = status === "open";
    this.statusEl.textContent = status === "open" ? "Connected" : status === "connecting" ? "Connecting to server…" : "Server offline · retrying";
    this.statusEl.className = "net " + status;
    this.findBtn.disabled = !this.connected;
    this.practiceBtn.disabled = !this.connected;
    this.roomBtn.disabled = !this.connected;
    this.joinBtn.disabled = !this.connected;
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
  setFullLabel(on: boolean, note?: string) {
    $("btnFull").querySelector("b")!.textContent = note ?? (on ? "On" : "Off");
    $("fsCornerLabel").textContent = note ?? (on ? "Exit full screen" : "Full screen");
  }

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
    this.againBtn.textContent = this.room ? "Back to room" : practice ? "Practice again" : "Find another match";
    this.menuBtn.textContent = this.room ? "Leave room" : "Main menu";
    this.show("results");
  }

  // ---------------------------------------------------------------- private room

  inviteLink(code: string): string {
    const u = new URL(location.href);
    u.hash = "";
    u.searchParams.set("room", code);
    return u.toString();
  }

  setRoom(r: RoomState | null) {
    this.room = r;
    if (!r) return;
    $("roomCode").textContent = r.code;
    ($("roomLink") as HTMLInputElement).value = this.inviteLink(r.code);
    const names = $("roomNames");
    names.innerHTML = r.players.map((p) =>
      `<li class="${p.y ? "you" : ""}">${esc(p.n)}${p.h ? '<span class="tagp">HOST</span>' : ""}${p.y ? '<span class="tagp">YOU</span>' : ""}</li>`,
    ).join("") + Array.from({ length: Math.max(0, r.max - r.players.length) }, () => `<li class="empty${r.bots ? " bot" : ""}"></li>`).join("");
    const humans = r.players.length;
    const canStart = r.host && !r.live && (humans >= 2 || !!r.bots);
    this.roomStartBtn.hidden = !r.host;
    this.roomStartBtn.disabled = !canStart;
    this.roomBotsBtn.setAttribute("aria-checked", String(!!r.bots));
    this.roomBotsBtn.disabled = !r.host;
    $("roomBotsHint").textContent = r.host ? "Bots take any seats your friends don't." : "The host decides.";
    $("roomArenaName").textContent = r.arena >= 0 && ARENAS[r.arena] ? `Arena: ${ARENAS[r.arena].name}` : "Arena: Random";
    $("roomArenaHint").textContent = r.host ? "Pick the arena for the next match, or leave it random." : "The host picks the arena.";
    this.roomArenaBtn.disabled = !r.host;
    const me = r.players.find((p) => p.y);
    $("roomLive").textContent = r.live ? "Match in progress" : "";
    $("roomInfo").textContent = r.live
      ? me?.p ? "You're in the match." : "A match is running. You'll be in the next one."
      : r.host
        ? humans >= 2 || r.bots ? "Start when everyone's here." : "Send the link to a friend, or turn on bots to start now."
        : "Waiting for the host to start.";
    // Keep the controller focus on something usable after the buttons change.
    if (this.screen === "room") {
      const f = document.querySelector<HTMLElement>("#scrRoom .nav-focus");
      if (!f || (f as HTMLButtonElement).disabled || f.hidden) {
        const first = this.navItems()[0];
        if (first) this.setNavFocus(first, false);
      }
    }
  }

  async copyLink() {
    if (!this.room) return;
    const link = this.inviteLink(this.room.code);
    const input = $("roomLink") as HTMLInputElement;
    const btn = $("btnCopy");
    let ok = false;
    try { await navigator.clipboard.writeText(link); ok = true; } catch {
      try { input.select(); ok = document.execCommand("copy"); } catch {}
    }
    btn.textContent = ok ? "Copied" : "Select + copy";
    setTimeout(() => { btn.textContent = "Copy link"; }, 1800);
  }

  // ---------------------------------------------------------------- weapon picker

  cycleWeapon(d: number) {
    this.weapon = (this.weapon + d + WEAPONS.length) % WEAPONS.length;
    try { localStorage.setItem("oc.weapon", String(this.weapon)); } catch {}
    this.renderWeapon();
    sfx.ui();
    this.onWeapon(this.weapon);
  }

  renderWeapon() {
    const w = WEAPONS[this.weapon];
    $("weaponName").textContent = w.name;
    $("weaponTrait").innerHTML = `<b>${esc(w.trait)}</b>${esc(w.desc)}`;
    $("roomWeaponName").textContent = `Your weapon: ${w.name}`;
    $("roomWeaponTrait").innerHTML = `<b>${esc(w.trait)}</b>${esc(w.desc)}`;
  }

  /** Host only: Random, then each arena in turn. */
  cycleRoomArena(d: number) {
    if (!this.room?.host) return;
    const n = ARENAS.length + 1;
    const next = ((this.room.arena + 1 + d + n) % n) - 1;
    sfx.ui();
    this.onRoomArena(next);
  }
}
