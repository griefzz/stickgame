import { PROTOCOL, type ServerMsg } from "../shared/protocol";

function defaultUrl(): string {
  const q = new URLSearchParams(location.search).get("server");
  if (q) return q;
  if (location.protocol === "file:" || !location.host) return "ws://localhost:8787/ws";
  return `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/ws`;
}

type Status = "connecting" | "open" | "closed";

export class Net {
  url = defaultUrl();
  ws: WebSocket | null = null;
  status: Status = "closed";
  offset = 0;
  rtt = 0.08;
  synced = false;
  private samples: { rtt: number; off: number }[] = [];
  private pingTimer = 0;
  private retry = 0;
  private pingsSent = 0;
  onMsg: (m: ServerMsg) => void = () => {};
  onStatus: (s: Status) => void = () => {};
  helloName = "";

  connect() {
    if (this.ws) return;
    this.setStatus("connecting");
    let ws: WebSocket;
    try { ws = new WebSocket(this.url); } catch { this.scheduleReconnect(); return; }
    this.ws = ws;
    ws.onopen = () => {
      this.retry = 0;
      this.samples = [];
      this.synced = false;
      this.pingsSent = 0;
      this.setStatus("open");
      this.send({ t: "hi", name: this.helloName, v: PROTOCOL });
      this.ping();
    };
    ws.onmessage = (ev) => {
      let m: ServerMsg;
      try { m = JSON.parse(ev.data as string); } catch { return; }
      if (m.t === "po") { this.onPong(m.c, m.s); return; }
      this.onMsg(m);
    };
    ws.onclose = () => {
      this.ws = null;
      clearTimeout(this.pingTimer);
      this.setStatus("closed");
      this.scheduleReconnect();
    };
    ws.onerror = () => { /* close follows */ };
  }

  private scheduleReconnect() {
    const wait = Math.min(8000, 600 * 2 ** this.retry++);
    setTimeout(() => this.connect(), wait);
  }

  private setStatus(s: Status) { this.status = s; this.onStatus(s); }

  send(o: object) { if (this.ws && this.ws.readyState === 1) this.ws.send(JSON.stringify(o)); }
  sendRaw(s: string) { if (this.ws && this.ws.readyState === 1) this.ws.send(s); }

  private ping() {
    clearTimeout(this.pingTimer);
    this.send({ t: "p", c: performance.now() / 1000, r: Math.round(this.rtt * 1000) / 1000 });
    this.pingsSent++;
    this.pingTimer = window.setTimeout(() => this.ping(), this.pingsSent < 6 ? 150 : 1000);
  }

  private onPong(c: number, s: number) {
    const t = performance.now() / 1000;
    const rtt = Math.max(0, t - c);
    const off = s + rtt / 2 - t;
    this.samples.push({ rtt, off });
    if (this.samples.length > 12) this.samples.shift();
    let best = this.samples[0];
    for (const x of this.samples) if (x.rtt < best.rtt) best = x;
    const avg = this.samples.reduce((a, x) => a + x.rtt, 0) / this.samples.length;
    this.rtt = this.rtt * 0.6 + avg * 0.4;
    if (!this.synced || Math.abs(best.off - this.offset) > 0.06) this.offset = best.off;
    else this.offset += (best.off - this.offset) * 0.15;
    this.synced = true;
  }

  serverNow(): number { return performance.now() / 1000 + this.offset; }
}
