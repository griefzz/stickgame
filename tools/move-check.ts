// Unit checks for the shared movement and ball physics (no server needed).
// Usage: bun tools/move-check.ts
import { BALL_R, HX, HY, PLAYER, SPEED_FIRST, SPEED_MAX, SWING, WEAPONS, nextSpeed } from "../src/shared/constants";
import { ARENAS, constrain, containsBall, inside, randomPoint, shellDist, type Arena } from "../src/shared/arena";

// "Inside" for a player: feet sphere inside the shell, or inside the floor plan (and off the blocks).
const playerIn = (a: Arena, p: { x: number; y: number; z: number }, tol: number) =>
  a.shell ? shellDist(a.shell, p.x, p.y + PLAYER.wallMargin, p.z) + PLAYER.wallMargin <= tol && inside(a, p.x, p.z, PLAYER.wallMargin - tol, p.y + PLAYER.wallMargin)
    : inside(a, p.x, p.z, PLAYER.wallMargin - tol);
const ballIn = (a: Arena, k: { x: number; y: number; z: number }, tol: number) =>
  a.shell ? shellDist(a.shell, k.x, k.y, k.z) + BALL_R <= tol : inside(a, k.x, k.z, BALL_R - tol) && k.y >= BALL_R - tol && k.y <= a.top - BALL_R + tol;
import { advanceBall, newKin } from "../src/shared/ball";
import { B_DASH, B_JUMP, B_JUMP_P, B_SWING, newPState, stepPlayer, type PState } from "../src/shared/player";
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

// Weapons: recovery after a whiff differs (hammer slow, staff fast).
{
  const ham = newPState(0, 0, 0), staff = newPState(0, 0, 2);
  stepPlayer(ham, { s: 0, mx: 0, mz: 0, ay: 0, ax: 0, b: B_SWING, t: 0 }, false);
  stepPlayer(staff, { s: 0, mx: 0, mz: 0, ay: 0, ax: 0, b: B_SWING, t: 0 }, false);
  check("weapons: hammer recovers slower than staff", ham.cd === WEAPONS[0].recover && staff.cd === WEAPONS[2].recover && ham.cd > staff.cd, `${ham.cd} vs ${staff.cd} ticks`);
}

// Arenas: the ball never escapes, reflections follow each wall's angle, players stay inside.
{
  for (let ai = 0; ai < ARENAS.length; ai++) {
    const a = ARENAS[ai];
    const k = newKin(ai); k.y = 5; k.vx = 173; k.vy = 41; k.vz = -97;
    let escaped = 0, bounces = 0;
    for (let i = 0; i < 6000; i++) {
      advanceBall(k, 1 / 600, () => bounces++);
      if (!containsBall(a, k.x, k.y, k.z, BALL_R)) escaped++;
    }
    const sp = Math.hypot(k.vx, k.vy, k.vz);
    check(`${a.key}: fast ball stays inside for 10 s`, escaped === 0 && Math.abs(sp - Math.hypot(173, 41, 97)) < 1e-6, `${bounces} bounces`);
    const p = newPState(0, 0, 0, ai);
    for (let i = 0; i < 400; i++) step(p, 0, Math.cos(i / 40), Math.sin(i / 40));
    check(`${a.key}: player can't leave`, playerIn(a, p, 1e-6), `(${p.x.toFixed(1)}, ${p.y.toFixed(1)}, ${p.z.toFixed(1)})`);
  }
  // Octagon diagonal: a ball flying straight at the 45 degree wall comes straight back.
  const oi = ARENAS.findIndex((x) => x.key === "octagon");
  const w = ARENAS[oi].walls.find((x) => x.nx > 0.6 && x.nz > 0.6)!;
  const k = newKin(oi); k.y = 5; k.vx = w.nx * 40; k.vz = w.nz * 40;
  for (let i = 0; i < 200; i++) advanceBall(k, 1 / 400); // 0.5 s: one bounce (the wall is 12.7 m out)
  check("octagon: head-on hit on a diagonal wall comes straight back", Math.abs(k.vx + w.nx * 40) < 1e-6 && Math.abs(k.vz + w.nz * 40) < 1e-6, `v=(${k.vx.toFixed(1)}, ${k.vz.toFixed(1)})`);
  // Circle: a ball fired from the centre comes back through the centre.
  const ci = ARENAS.findIndex((x) => x.key === "circle");
  const c = newKin(ci); c.y = 5; c.vx = 30; c.vz = 10;
  for (let i = 0; i < 300; i++) advanceBall(c, 1 / 300);
  const cross = Math.abs(c.x * c.vz - c.z * c.vx) / Math.hypot(c.vx, c.vz);
  check("circle: radial shot bounces back along the radius", cross < 0.05, `miss distance ${cross.toFixed(3)} m`);
  // Wall jump off the circle's curved wall kicks back toward the middle.
  const r = ARENAS[ci].radius - PLAYER.wallMargin;
  const pj = newPState(r * Math.SQRT1_2, r * Math.SQRT1_2, 0, ci);
  step(pj, B_JUMP | B_JUMP_P, 1, 1);
  for (let i = 0; i < 8; i++) step(pj, B_JUMP, 1, 1);
  step(pj, B_JUMP | B_JUMP_P, 1, 1);
  // Slide: running at the long wall carries you up the curve; the sphere does the same.
  for (const key of ["slide", "sphere"]) {
    const si = ARENAS.findIndex((x) => x.key === key);
    const ps = newPState(0, 0, 0, si);
    let top = 0;
    for (let i = 0; i < 120; i++) { step(ps, 0, 0, 1); top = Math.max(top, ps.y); }
    check(`${key}: running into the curved edge rides up it`, top > 1.5 && playerIn(ARENAS[si], ps, 1e-6), `peak ${top.toFixed(2)} m`);
  }
  // Sphere: a dropped lob settles on the floor and stays inside.
  {
    const si = ARENAS.findIndex((x) => x.key === "sphere");
    const k = newKin(si); k.lob = true; k.y = 8; k.vx = 9; k.vz = 4;
    for (let i = 0; i < 6000; i++) advanceBall(k, 1 / 600);
    check("sphere: a lob comes to rest on the floor", Math.abs(k.y - BALL_R) < 1e-3 && Math.hypot(k.vx, k.vz) < 0.5 && ballIn(ARENAS[si], k, 1e-6), `y=${k.y.toFixed(3)} v=${Math.hypot(k.vx, k.vz).toFixed(2)}`);
  }
  // Maze: the inner walls stop the ball dead-on and stop players.
  {
    const mi = ARENAS.findIndex((x) => x.key === "maze");
    const k = newKin(mi); k.x = 6; k.y = 3; k.vz = -40; // straight at the inner wall at z = -6.5
    for (let i = 0; i < 120; i++) advanceBall(k, 1 / 600);
    check("maze: inner walls bounce the ball", k.vz > 0 && k.z > -6.5, `z=${k.z.toFixed(2)} vz=${k.vz.toFixed(1)}`);
    const pm = newPState(6, 0, 0, mi);
    for (let i = 0; i < 120; i++) step(pm, 0, 0, -1);
    check("maze: players can't walk through inner walls", pm.z > -6.5 && pm.z < -5.8, `z=${pm.z.toFixed(2)}`);
  }
  check("circle: wall jump kicks back toward the centre", pj.wj === 1 && pj.vx < -4 && pj.vz < -4, `v=(${pj.vx.toFixed(1)}, ${pj.vz.toFixed(1)})`);
}

// Wavedash: jump + dash on the same tick skids along the floor at dash speed, and since you
// never really leave the ground the dash refunds at once, so it chains.
{
  const run = newPState(-14, 0), wd = newPState(-14, 0);
  for (let i = 0; i < 60; i++) step(run, 0, 1, 0);
  for (let i = 0; i < 60; i++) step(wd, i % PLAYER.dashTicks === 0 ? B_JUMP_P | B_DASH : 0, 1, 0);
  const runD = run.x + 14, wdD = wd.x + 14;
  check("wavedash: chains at about twice running speed", wdD > runD * 1.8 && wd.y === 0, `1 s: ${wdD.toFixed(1)} m vs ${runD.toFixed(1)} m running`);
}

// Aiming during your own freeze: 90 degree window around the contact facing, swept at 180 deg/s.
{
  const p = newPState(0, 0);
  p.f = 0; p.af = 0;
  const frozenStep = (mx: number, mz: number) => stepPlayer(p, { s: 0, mx, mz, ay: 0, ax: 0, b: 0, t: 0 }, true);
  for (let i = 0; i < 6; i++) frozenStep(-0.01, -1); // stick straight behind
  const after01 = p.f;
  for (let i = 0; i < 120; i++) frozenStep(-0.01, -1);
  const deg = (r: number) => ((r * 180) / Math.PI).toFixed(1);
  check("charge aim: sweeps instead of snapping", Math.abs(after01) <= Math.PI * 0.1 + 1e-9 && Math.abs(after01) > 0.1, `${deg(after01)} deg after 0.1 s`);
  check("charge aim: stops at the edge of the 90 degree window", Math.abs(Math.abs(p.f) - SWING.aimCone) < 1e-9, `${deg(p.f)} deg after 2 s`);
}

// No squeeze points: from every legal spot on a fine grid, a dash-length step in any
// direction settles back inside (a gap narrower than a player would leave them wedged).
{
  for (const a of ARENAS) {
    if (a.shell) continue;
    let bad = 0, where = "";
    for (let x = -a.hx + 0.13; x <= a.hx; x += 0.25) for (let z = -a.hz + 0.13; z <= a.hz; z += 0.25) {
      if (!inside(a, x, z, PLAYER.wallMargin)) continue;
      for (let k = 0; k < 8; k++) {
        const p = { x: x + Math.sin(k * Math.PI / 4) * 0.5, z: z + Math.cos(k * Math.PI / 4) * 0.5 };
        constrain(a, p, PLAYER.wallMargin);
        if (!inside(a, p.x, p.z, PLAYER.wallMargin - 0.01)) { bad++; where ||= `(${x.toFixed(1)}, ${z.toFixed(1)})`; }
      }
    }
    check(`${a.key}: no squeeze points`, bad === 0, bad ? `${bad} spots, e.g. ${where}` : "");
  }
}

// Fuzz: random balls (up to top speed) and random players never end up outside any arena.
{
  let seed = 12345;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  for (let ai = 0; ai < ARENAS.length; ai++) {
    const a = ARENAS[ai];
    let ballOut = 0, playerOut = 0;
    for (let n = 0; n < 200; n++) {
      const st = randomPoint(a, 1, rnd);
      const k = newKin(ai); k.x = st.x; k.z = st.z; k.y = 1 + rnd() * 10;
      const sp = 20 + rnd() * 480, th = rnd() * Math.PI * 2, ph = (rnd() - 0.5) * 1.2;
      k.vx = Math.sin(th) * Math.cos(ph) * sp; k.vz = Math.cos(th) * Math.cos(ph) * sp; k.vy = Math.sin(ph) * sp;
      if (rnd() < 0.3) { k.cv = (rnd() - 0.5) / 6; k.ct = 1.25; }
      for (let i = 0; i < 60; i++) {
        const sub = Math.max(1, Math.ceil((sp / 60) / 0.4));
        for (let j = 0; j < sub; j++) advanceBall(k, 1 / 60 / sub);
        if (!ballIn(a, k, 1e-3)) { ballOut++; break; }
      }
    }
    for (let n = 0; n < 40; n++) {
      const st = randomPoint(a, 2, rnd);
      const p = newPState(st.x, st.z, 0, ai);
      let mx = 0, mz = 0;
      for (let i = 0; i < 600; i++) {
        if (i % 20 === 0) { const t = rnd() * Math.PI * 2; mx = Math.sin(t); mz = Math.cos(t); }
        const b = (rnd() < 0.05 ? B_JUMP_P | B_JUMP : 0) | (rnd() < 0.04 ? B_DASH : 0);
        step(p, b, mx, mz);
        if (!playerIn(a, p, 0.01)) { playerOut++; break; }
      }
    }
    check(`${a.key}: fuzz, 200 random balls + 40 random players stay inside`, ballOut === 0 && playerOut === 0, `balls out ${ballOut}, players out ${playerOut}`);
  }
}

// Speed ramp: about 15 plain hits to reach 330 on the speedometer, about 30 to the 1000 cap.
{
  let s = SPEED_FIRST, n = 1, to330 = 0;
  while (s < SPEED_MAX && n < 100) { s = nextSpeed(s); n++; if (!to330 && s * 2 >= 330) to330 = n; }
  check("speed ramp: ~15 hits to 330, ~30 to 1000", to330 >= 13 && to330 <= 17 && n >= 26 && n <= 34, `${to330} hits to 330, ${n} to 1000`);
}

process.exit(fails ? 1 : 0);
