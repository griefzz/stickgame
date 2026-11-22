// Unit checks for the shared movement and ball physics (no server needed).
// Usage: bun tools/move-check.ts
import { HX, PLAYER } from "../src/shared/constants";
import { advanceBall, newKin } from "../src/shared/ball";
import { B_DASH, B_JUMP, B_JUMP_P, newPState, stepPlayer, type PState } from "../src/shared/player";
import { CURVE_TURN, shotDir } from "../src/shared/shot";

let fails = 0;
const check = (label: string, ok: boolean, detail = "") => { console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? "  " + detail : ""}`); if (!ok) fails++; };
const step = (p: PState, b: number, mx = 0, mz = 0) => stepPlayer(p, { s: 0, mx, mz, ay: 0, ax: 0, b, t: 0 }, false);
const land = (p: PState) => { for (let i = 0; i < 300 && !p.g; i++) step(p, 0); };

// Double jump: one air jump, refreshed on landing.
{
  const p = newPState(0, 0);
  step(p, B_JUMP | B_JUMP_P);
  for (let i = 0; i < 20; i++) step(p, B_JUMP);
  step(p, B_JUMP | B_JUMP_P);
  const used = p.aj, vy = p.vy;
  for (let i = 0; i < 5; i++) step(p, B_JUMP);
  const before = p.vy; step(p, B_JUMP | B_JUMP_P);
  check("double jump: one air jump", used === 1 && vy > 10 && p.vy < before, `aj=${used} vy=${vy.toFixed(1)}`);
  land(p);
  check("double jump: refreshed on landing", p.aj === 0 && p.g === 1);
}

// Wall jump: kick away from the wall, restore air jump + dash, max 3 per airtime.
{
  const xmax = HX - PLAYER.wallMargin;
  const p = newPState(xmax, 0);
  step(p, B_JUMP | B_JUMP_P, 1, 0);
  for (let i = 0; i < 8; i++) step(p, B_JUMP, 1, 0);
  step(p, B_JUMP | B_JUMP_P, 1, 0); // double jump against the wall first? no: touching the wall -> wall jump
  check("wall jump: kicks away from the wall", p.wj === 1 && p.vx < -5 && p.vy > 10, `vx=${p.vx.toFixed(1)} vy=${p.vy.toFixed(1)}`);
  check("wall jump: air jump stays available", p.aj === 0);
  // Climb: drift back to the wall and kick again, up to the limit.
  let kicks = 1;
  for (let n = 0; n < 6; n++) {
    for (let i = 0; i < 40 && p.x < xmax - 0.01 && !p.g; i++) step(p, B_JUMP, 1, 0);
    if (p.g) break;
    const w = p.wj; step(p, B_JUMP | B_JUMP_P, 1, 0); if (p.wj > w) kicks++;
  }
  check("wall jump: capped at 3 per airtime", kicks === PLAYER.wallJumps, `kicks=${kicks}`);
  land(p);
  check("wall jump: refreshed on landing", p.wj === 0);
}

// Wall slide: pushing into a wall while falling caps the fall speed.
{
  const xmax = HX - PLAYER.wallMargin;
  const p = newPState(xmax, 0);
  step(p, B_JUMP | B_JUMP_P, 1, 0);
  for (let i = 0; i < 40; i++) step(p, B_JUMP, 1, 0);
  check("wall slide: fall capped while pushing into the wall", p.vy >= -PLAYER.wallSlide - 1e-9 && !p.g, `vy=${p.vy.toFixed(2)}`);
}

// Air dash: airborne only, fast and flat for dashTicks, once per airtime.
{
  const g = newPState(0, 0);
  step(g, B_DASH, 1, 0);
  check("air dash: not on the ground", g.dc === 0 && g.ds === 0);
  const p = newPState(0, 0);
  step(p, B_JUMP | B_JUMP_P);
  for (let i = 0; i < 6; i++) step(p, B_JUMP);
  const y0 = p.y;
  step(p, B_DASH, 1, 0);
  const sp = p.vx;
  for (let i = 0; i < PLAYER.dashTicks - 1; i++) step(p, 0, 1, 0);
  check("air dash: fast and flat", sp >= PLAYER.dashSpeed - 1e-9 && Math.abs(p.y - y0) < 1e-6 && p.ds === 0, `vx=${sp} dy=${(p.y - y0).toFixed(4)}`);
  step(p, 0, 1, 0);
  check("air dash: gravity resumes after", p.vy < 0);
  step(p, B_DASH, -1, 0);
  check("air dash: once per airtime", p.vx > 0);
}

// Curve: bends the path, same shape at any speed, stops after the turn budget or a bounce.
{
  const turn = (speed: number) => {
    const k = newKin(); k.x = 0; k.y = 5; k.z = 8; k.vz = -speed; k.cv = 1 / 13; k.ct = CURVE_TURN;
    for (let i = 0; i < 2000 && k.cv !== 0 && k.z > -9; i++) advanceBall(k, 0.4 / speed);
    return { k, ang: Math.atan2(k.vx, -k.vz) };
  };
  const a = turn(20), b = turn(150);
  check("curve: bends the ball", Math.abs(a.ang) > 0.5, `${a.ang.toFixed(2)} rad`);
  check("curve: same arc at 20 and 150 speed", Math.abs(a.k.x - b.k.x) < 0.3 && Math.abs(a.k.z - b.k.z) < 0.3, `x ${a.k.x.toFixed(2)} vs ${b.k.x.toFixed(2)}`);
  check("curve: speed unchanged", Math.abs(Math.hypot(b.k.vx, b.k.vz) - 150) < 1e-6);
  const w = newKin(); w.x = 13; w.y = 5; w.z = 0; w.vx = 30; w.cv = 1 / 13; w.ct = CURVE_TURN;
  for (let i = 0; i < 20; i++) advanceBall(w, 0.01);
  check("curve: spin dies on the first bounce", w.cv === 0 && w.ct === 0);
  const s = shotDir(Math.PI, 0, 1, false, { x: 0, y: 2, z: 0 }, [{ x: 0, y: 0, z: -10 }]);
  check("curve: right-curving shots skip aim assist", s.target === -1 && s.cv > 0 && s.label === "CURVEBALL", s.label);
  // facing -z (away from camera), curve right should bend toward +x (screen right)
  const k = newKin(); k.y = 5; k.vx = s.x * 20; k.vz = s.z * 20; k.cv = s.cv; k.ct = s.ct;
  for (let i = 0; i < 20; i++) advanceBall(k, 0.02);
  check("curve: right means the hitter's right", k.x > 0.05, `x=${k.x.toFixed(2)}`);
}

process.exit(fails ? 1 : 0);
