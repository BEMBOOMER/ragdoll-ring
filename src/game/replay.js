// Herhaling: een ringbuffer met de standen van alle lichaamsdelen, zodat een knock-out
// achteraf vanuit elke hoek en in slowmotion terug te zien is. Puur data, geen weergave.
export class ReplayRecorder {
  constructor(seconds = 18, rate = 60) {
    this.rate = rate;
    this.cap = Math.ceil(seconds * rate);
    this.count = 0;
  }

  reset(fighters) {
    this.layout = fighters.map((f) => Object.keys(f.parts));
    this.stride = this.layout.reduce((n, parts) => n + parts.length, 0) * 7;
    this.data = new Float32Array(this.cap * this.stride);
    this.times = new Float64Array(this.cap);
    this.head = 0;
    this.count = 0;
    this.next = -Infinity;
  }

  capture(time, fighters) {
    if (!this.data || time < this.next) return;
    this.next = time + 1 / this.rate - 1e-6;
    const d = this.data;
    let o = this.head * this.stride;
    fighters.forEach((f, i) => {
      for (const name of this.layout[i]) {
        const part = f.parts[name];
        const p = part.curP;
        const q = part.curQ;
        d[o++] = p.x;
        d[o++] = p.y;
        d[o++] = p.z;
        d[o++] = q.x;
        d[o++] = q.y;
        d[o++] = q.z;
        d[o++] = q.w;
      }
    });
    this.times[this.head] = time;
    this.head = (this.head + 1) % this.cap;
    this.count = Math.min(this.count + 1, this.cap);
  }

  // Index in de buffer van het k-de oudste frame.
  slot(k) {
    return (this.head - this.count + k + this.cap) % this.cap;
  }

  span() {
    if (!this.count) return null;
    return { from: this.times[this.slot(0)], to: this.times[this.slot(this.count - 1)] };
  }

  // Beperk een gewenst tijdvak tot wat er in de buffer zit.
  clip(from, to) {
    const s = this.span();
    if (!s) return null;
    const a = Math.max(from, s.from);
    const b = Math.min(to, s.to);
    return b - a > 0.2 ? { from: a, to: b } : null;
  }

  // Roept fn(fighterIndex, partName, [x,y,z], [qx,qy,qz,qw]) aan voor tijdstip t,
  // lineair geïnterpoleerd tussen de twee omliggende frames.
  sample(t, fn) {
    if (!this.count) return;
    let lo = 0;
    let hi = this.count - 1;
    if (t <= this.times[this.slot(0)]) hi = 0;
    else if (t >= this.times[this.slot(hi)]) lo = hi;
    else {
      while (hi - lo > 1) {
        const mid = (lo + hi) >> 1;
        if (this.times[this.slot(mid)] <= t) lo = mid;
        else hi = mid;
      }
    }
    const a = this.slot(lo);
    const b = this.slot(hi);
    const ta = this.times[a];
    const tb = this.times[b];
    const u = tb > ta ? Math.min(1, Math.max(0, (t - ta) / (tb - ta))) : 0;
    const d = this.data;
    let oa = a * this.stride;
    let ob = b * this.stride;
    const p = [0, 0, 0];
    const q = [0, 0, 0, 1];
    this.layout.forEach((parts, i) => {
      for (const name of parts) {
        for (let k = 0; k < 3; k++) p[k] = d[oa + k] + (d[ob + k] - d[oa + k]) * u;
        // Quaternionen: korte weg en normaliseren (nlerp is genoeg bij 60 Hz).
        const dot = d[oa + 3] * d[ob + 3] + d[oa + 4] * d[ob + 4] + d[oa + 5] * d[ob + 5] + d[oa + 6] * d[ob + 6];
        const s = dot < 0 ? -1 : 1;
        let len = 0;
        for (let k = 0; k < 4; k++) {
          q[k] = d[oa + 3 + k] + (s * d[ob + 3 + k] - d[oa + 3 + k]) * u;
          len += q[k] * q[k];
        }
        len = Math.sqrt(len) || 1;
        for (let k = 0; k < 4; k++) q[k] /= len;
        fn(i, name, p, q);
        oa += 7;
        ob += 7;
      }
    });
  }
}
