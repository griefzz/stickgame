import { BALL_SPAWN, SPEED_NEUTRAL } from "../shared/constants";
import type { ServerMsg } from "../shared/protocol";
import { isMuted, setMuted, sfx, unlockAudio } from "./audio";
import { ClientMatch } from "./game";
import { gamepadName, lastDevice, onUi, pollPads, setGameActive } from "./input";
import { Menu } from "./menu";
import { Net } from "./net";
import { setTelegraph, updateBall } from "./render/ball";
import { CAM_LABEL, CAM_MODES, camMode, setCamMode, type CamMode } from "./render/camera";
import { updateFx } from "./render/fx";
import { WHITE, camera, render, updateCrowd, updateWalls } from "./render/scene";

declare const __BUILD__: string; // injected by build.ts

const net = new Net();
const menu = new Menu();
let match: ClientMatch | null = null;
let paused = false;

try {
  const c = localStorage.getItem("oc.cam") as CamMode | null;
  if (c && CAM_MODES.includes(c)) setCamMode(c);
} catch {}
menu.setCamLabel(CAM_LABEL[camMode()]);
menu.setSoundLabel(isMuted());

net.helloName = menu.name();
net.onStatus = (s) => {
  menu.setConnection(s);
  if (s === "closed") {
    if (match) endMatch();
    if (menu.screen !== "title") menu.show("title");
  }
};
net.onMsg = (m: ServerMsg) => {
  switch (m.t) {
    case "w": menu.setServerCfg(m.size, m.bf); serverBuild = m.b; maybeReload(); break;
    case "st": menu.setOnline(m.on, m.q, m.m); serverBuild = m.b; maybeReload(); break;
    case "qs": menu.setQueue(m.n, m.min, m.max, m.sIn, m.names, m.bf, m.bo); break;
    case "go": startMatch(m); break;
    case "s": match?.onSnapshot(m); break;
    case "e": match?.onEvent(m); break;
    case "end":
      if (m.r === "afk") { endMatch(); menu.show("title"); menu.notice("Removed from the match for inactivity"); }
      else if (match && !match.over) { endMatch(); menu.show("title"); }
      break;
  }
};
net.connect();

function startMatch(m: Extract<ServerMsg, { t: "go" }>) {
  if (match) match.dispose();
  const practice = !!m.practice;
  const cm = new ClientMatch(net, m.slot, m.roster, m.cdEnd, practice);
  cm.onOver = (rank, w) => {
    setGameActive(false);
    menu.showResults(rank, w, m.roster, m.slot, practice);
  };
  match = cm;
  paused = false;
  menu.show("none");
  setGameActive(true);
  sfx.found();
}

function endMatch() {
  match?.dispose();
  match = null;
  paused = false;
  setGameActive(false);
}

function setPaused(p: boolean) {
  if (!match) return;
  paused = p;
  match.controls = !p;
  setGameActive(!p);
  menu.show(p ? "pause" : "none");
}

function cycleCam() {
  const i = CAM_MODES.indexOf(camMode());
  const next = CAM_MODES[(i + 1) % CAM_MODES.length];
  setCamMode(next);
  try { localStorage.setItem("oc.cam", next); } catch {}
  menu.setCamLabel(CAM_LABEL[next]);
}

function toggleMute() {
  setMuted(!isMuted());
  menu.setSoundLabel(isMuted());
}

menu.onName = (n) => { net.helloName = n; net.send({ t: "name", name: n }); };
function joinQueue() {
  net.send({ t: "q", bots: menu.botsPref ? 1 : 0 });
  menu.show("queue");
  menu.setQueue(1, 2, menu.matchSize, -1, [menu.name()], 0, -1);
}
menu.onFind = () => { unlockAudio(); joinQueue(); };
menu.onBots = (on) => { if (menu.screen === "queue") net.send({ t: "bots", on: on ? 1 : 0 }); };
menu.onPractice = () => { unlockAudio(); net.send({ t: "pr" }); };
menu.onCancel = () => { net.send({ t: "x" }); menu.show("title"); };
menu.onResume = () => setPaused(false);
menu.onLeave = () => { net.send({ t: "lv" }); endMatch(); menu.show("title"); };
menu.onCam = cycleCam;
menu.onMute = toggleMute;
menu.onAgain = () => {
  const practice = match?.practice;
  endMatch();
  net.send({ t: "lv" }); // make sure the server has us back in the menu state
  if (practice) net.send({ t: "pr" });
  else joinQueue();
};
menu.onMenu = () => { endMatch(); net.send({ t: "lv" }); menu.show("title"); };

onUi((e) => {
  unlockAudio();
  if (e === "cam") { cycleCam(); return; }
  if (e === "mute") { toggleMute(); return; }
  if (match && !match.over && menu.screen === "none") {
    if (e === "start") setPaused(true);
    return;
  }
  if (e === "start" && menu.screen === "pause") { setPaused(false); return; }
  menu.handleUi(e);
});
window.addEventListener("pointerdown", () => unlockAudio(), { once: false });
window.addEventListener("blur", () => { if (match && !match.over && !paused) setPaused(true); });

// ------------------------------------------------------------------ loop

function attract(dt: number, rt: number) {
  const a = rt * 0.06;
  camera.position.set(Math.sin(a) * 34, 12 + Math.sin(rt * 0.13) * 2, Math.cos(a) * 34);
  camera.lookAt(0, 4, 0);
  if (Math.abs(camera.fov - 42) > 0.01) { camera.fov = 42; camera.updateProjectionMatrix(); }
  camera.updateMatrixWorld();
  setTelegraph(false);
  updateBall(dt, rt, rt, {
    visible: true, x: BALL_SPAWN.x, y: BALL_SPAWN.y - 3 + Math.sin(rt * 1.6) * 0.3, z: BALL_SPAWN.z,
    color: WHITE, speedFrac: SPEED_NEUTRAL / 165, frozen: false, bigFreeze: false,
  });
}

let last = performance.now();
let padCheck = 0;
function frame(t: number) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.05, Math.max(0, (t - last) / 1000));
  last = t;
  const rt = t / 1000;
  pollPads(rt);
  if (rt > padCheck) { padCheck = rt + 0.5; menu.setPad(gamepadName(), lastDevice === "pad"); }
  if (match) match.frame(dt, rt);
  else attract(dt, rt);
  updateCrowd(dt, rt);
  updateFx(dt);
  updateWalls(dt);
  render();
  menu.tick();
}
requestAnimationFrame((t) => { last = t; frame(t); });
(window as unknown as { __ocReady: boolean }).__ocReady = true;

// ------------------------------------------------------------------ auto-update
// The server announces the build ID of the page it's serving. When a deploy lands,
// players idling on the title screen reload into it; nobody is pulled out of a match
// or the queue. sessionStorage stops a reload loop if a stale cache serves the old page.
let serverBuild = "";
function maybeReload() {
  if (!serverBuild || serverBuild === __BUILD__ || match || menu.screen !== "title") return;
  if (document.activeElement === menu.nameEl) return;
  try {
    if (sessionStorage.getItem("oc.reloadedFor") === serverBuild) return;
    sessionStorage.setItem("oc.reloadedFor", serverBuild);
  } catch { return; }
  location.reload();
}
