// Shot direction at the end of hitstop. Shared so every client can draw the
// same aim telegraph the server will actually fire.

export interface ShotTarget { x: number; y: number; z: number }
export interface Shot { x: number; y: number; z: number; label: string; target: number; cv: number; ct: number }

const ASSIST = 0.3;        // radians either side of facing that snap to an opponent
const MAX_PITCH = 0.68;    // ~39 degrees for a full high/low aim
const ASSIST_PITCH = 0.45;
export const CURVE_RADIUS = 13;   // tightest bend (full curve input), in metres
export const CURVE_TURN = 1.25;   // most a curve can turn the ball (~72 degrees) before it straightens

export function shotDir(
  facing: number,
  aimY: number,
  curve: number,
  airborne: boolean,
  from: { x: number; y: number; z: number },
  targets: ReadonlyArray<ShotTarget | null>,
  curveMul = 1,          // weapon: higher bends tighter
): Shot {
  const fx = Math.sin(facing), fz = Math.cos(facing);
  const curving = Math.abs(curve) > 0.25;
  let best = -1, bestAng = ASSIST, bdx = 0, bdz = 0, bd = 0, bdy = 0;
  // Aim assist snaps straight shots onto a nearby opponent; curve shots are aimed by hand.
  if (!curving) {
    for (let i = 0; i < targets.length; i++) {
      const t = targets[i];
      if (!t) continue;
      const dx = t.x - from.x, dz = t.z - from.z;
      const d = Math.hypot(dx, dz);
      if (d < 1.5) continue;
      const dot = (dx * fx + dz * fz) / d;
      const ang = Math.acos(Math.max(-1, Math.min(1, dot)));
      if (ang < bestAng) { bestAng = ang; best = i; bdx = dx / d; bdz = dz / d; bd = d; bdy = t.y + 1.3 - from.y; }
    }
  }
  let hx = fx, hz = fz, pitch: number, label: string;
  if (best >= 0) { hx = bdx; hz = bdz; }
  if (Math.abs(aimY) > 0.25) {
    pitch = aimY * MAX_PITCH;
    label = aimY > 0 ? (curving ? "SKY CURVE" : "SKY SHOT") : (curving ? "CURVE SPIKE" : "SPIKE");
  } else if (best >= 0) {
    pitch = Math.max(-ASSIST_PITCH, Math.min(ASSIST_PITCH, Math.atan2(bdy, bd)));
    label = "SMASH";
  } else {
    pitch = airborne ? -0.12 : 0;
    label = curving ? "CURVEBALL" : "SMASH";
  }
  if (airborne) label = "AIR " + label;
  const c = Math.cos(pitch);
  // Positive curve bends to the hitter's right (clockwise seen from above).
  const cv = curving ? (Math.sign(curve) * Math.min(1, Math.abs(curve)) * curveMul) / CURVE_RADIUS : 0;
  return { x: hx * c, y: Math.sin(pitch), z: hz * c, label, target: best, cv, ct: curving ? CURVE_TURN : 0 };
}
