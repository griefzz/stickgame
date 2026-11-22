// Synthesised sound: no audio files, everything built from oscillators and noise.

let ctx: AudioContext | null = null;
let out: GainNode | null = null;
let noise: AudioBuffer | null = null;
let chargeOsc: OscillatorNode | null = null;
let muted = false;
try { muted = localStorage.getItem("oc.muted") === "1"; } catch {}

function init() {
  if (ctx) return;
  const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  if (!AC) return;
  ctx = new AC();
  out = ctx.createGain();
  out.gain.value = muted ? 0 : 0.5;
  const comp = ctx.createDynamicsCompressor();
  out.connect(comp);
  comp.connect(ctx.destination);
  noise = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
  const d = noise.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
}

/** Call from a user gesture so the browser allows playback. */
export function unlockAudio() {
  init();
  if (ctx && ctx.state === "suspended") ctx.resume().catch(() => {});
}

export function isMuted() { return muted; }
export function setMuted(m: boolean) {
  muted = m;
  try { localStorage.setItem("oc.muted", m ? "1" : "0"); } catch {}
  if (out && ctx) out.gain.setTargetAtTime(m ? 0 : 0.5, ctx.currentTime, 0.02);
  if (m) stopCharge();
}

const ok = () => !!ctx && !!out && !muted && ctx.state === "running";

function env(g: GainNode, t: number, a: number, peak: number, d: number) {
  g.gain.setValueAtTime(1e-4, t);
  g.gain.exponentialRampToValueAtTime(peak, t + a);
  g.gain.exponentialRampToValueAtTime(1e-4, t + a + d);
}
function hiss(freq: number, q: number, peak: number, dur: number) {
  const c = ctx!, t = c.currentTime;
  const s = c.createBufferSource();
  s.buffer = noise;
  const f = c.createBiquadFilter();
  f.type = "bandpass"; f.frequency.value = freq; f.Q.value = q;
  const g = c.createGain();
  env(g, t, 0.003, peak, dur);
  s.connect(f); f.connect(g); g.connect(out!);
  s.start(t); s.stop(t + dur + 0.05);
}
function tone(type: OscillatorType, f0: number, f1: number, peak: number, dur: number, delay = 0) {
  const c = ctx!, t = c.currentTime + delay;
  const o = c.createOscillator();
  o.type = type;
  o.frequency.setValueAtTime(f0, t);
  o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
  const g = c.createGain();
  env(g, t, 0.004, peak, dur);
  o.connect(g); g.connect(out!);
  o.start(t); o.stop(t + dur + 0.05);
}

export const sfx = {
  hit(k: number) {
    if (!ok()) return;
    hiss(1400 + 2600 * k, 0.9, 0.7, 0.09 + 0.16 * k);
    tone("sine", 170, 48, 0.9, 0.2);
    if (k > 0.5) tone("square", 2400, 900, 0.07, 0.06);
  },
  thump(k: number) { if (ok()) tone("sine", 120 + 60 * k, 60, 0.45, 0.1); },
  bounce(k: number) {
    if (!ok()) return;
    tone("triangle", 520 + 700 * k, 300, 0.22, 0.06);
    hiss(3000, 2, 0.14, 0.04);
  },
  whoosh() { if (ok()) hiss(900, 0.7, 0.12, 0.12); },
  airJump() { if (ok()) { tone("sine", 420, 900, 0.16, 0.12); hiss(2600, 1.2, 0.06, 0.05); } },
  bunt() { if (ok()) { tone("sine", 300, 520, 0.35, 0.12); hiss(2000, 1.5, 0.1, 0.05); } },
  charge(dur: number, k: number) {
    if (!ok()) return;
    stopCharge();
    const c = ctx!, t = c.currentTime;
    const o = c.createOscillator();
    o.type = "sawtooth";
    o.frequency.setValueAtTime(160, t);
    o.frequency.exponentialRampToValueAtTime(160 + 900 * k, t + dur);
    const f = c.createBiquadFilter();
    f.type = "lowpass";
    f.frequency.setValueAtTime(600, t);
    f.frequency.exponentialRampToValueAtTime(2600, t + dur);
    const g = c.createGain();
    g.gain.setValueAtTime(1e-4, t);
    g.gain.exponentialRampToValueAtTime(0.08, t + dur * 0.9);
    o.connect(f); f.connect(g); g.connect(out!);
    o.start(t); o.stop(t + dur + 0.02);
    chargeOsc = o;
  },
  ko() {
    if (!ok()) return;
    hiss(500, 0.5, 1, 0.9);
    tone("sine", 90, 26, 1, 1);
    tone("square", 1800, 200, 0.1, 0.5);
  },
  serve() { if (ok()) tone("sine", 660, 1320, 0.22, 0.18); },
  beep(high: boolean) { if (ok()) tone("square", high ? 1320 : 660, high ? 1320 : 660, 0.12, high ? 0.35 : 0.12); },
  ui() { if (ok()) tone("triangle", 880, 1100, 0.08, 0.05); },
  found() { if (ok()) { tone("sine", 520, 780, 0.25, 0.15); tone("sine", 780, 1170, 0.25, 0.2, 0.12); } },
  win() { if (ok()) { tone("triangle", 523, 523, 0.25, 0.2); tone("triangle", 659, 659, 0.25, 0.2, 0.15); tone("triangle", 784, 784, 0.3, 0.5, 0.3); } },
};
export function stopCharge() {
  if (chargeOsc) { try { chargeOsc.stop(); } catch {} chargeOsc = null; }
}
