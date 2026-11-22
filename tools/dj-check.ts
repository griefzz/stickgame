// Unit check: one air jump, refreshed on landing.
import { newPState, stepPlayer, B_JUMP, B_JUMP_P } from "../src/shared/player";
const p = newPState(0, 0);
const step = (b: number) => stepPlayer(p, { s: 0, mx: 0, mz: 0, ay: 0, b, t: 0 }, false);
step(B_JUMP | B_JUMP_P);
for (let i = 0; i < 20; i++) step(B_JUMP);
const h1 = p.y; step(B_JUMP | B_JUMP_P); const vy2 = p.vy, aj1 = p.aj;
for (let i = 0; i < 5; i++) step(B_JUMP);
step(B_JUMP | B_JUMP_P); const vy3 = p.vy; // third press: should do nothing
let peak = 0; for (let i = 0; i < 200; i++) { step(0); peak = Math.max(peak, p.y); }
console.log(`after 1st jump y=${h1.toFixed(2)}; 2nd press vy=${vy2.toFixed(1)} aj=${aj1}; 3rd press vy=${vy3.toFixed(1)} (falling, ignored); landed aj=${p.aj} g=${p.g}`);
console.log(vy2 > 10 && aj1 === 1 && vy3 < vy2 && p.aj === 0 && p.g === 1 ? "PASS  double jump" : "FAIL  double jump");
