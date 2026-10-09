// Handwritten notepad: pages of vector ink drawn with a stylus, finger or mouse.
// Strokes are kept in page coordinates (1000 × 1414, A4 proportions), so a note looks the same on
// every screen. Pressure from a stylus sets the line width. Once a pen has been used on a device,
// fingers scroll instead of drawing (palm rejection); the pen's eraser end erases.
import { zlibSync, unzlibSync, strToU8, strFromU8 } from 'fflate';

export const PW = 1000, PH = 1414;
export const COLORS = ['#1b1f24', '#1d4ed8', '#c8372f', '#0e9f6e', '#b45309', '#7c3aed'];
export const PAPERS = ['lined', 'grid', 'dots', 'blank'];
const HL = { w: 26, a: 0.32 };

export const encodeInk = ink => zlibSync(strToU8(JSON.stringify(ink)), { level: 6 });
export const decodeInk = u8 => JSON.parse(strFromU8(unzlibSync(u8)));
export const emptyInk = paper => ({ v: 1, pages: 1, paper: paper || 'lined', strokes: [] });

// Paper lines, drawn the same way on screen and in exports.
export function drawPaper(ctx, paper, s, ph = PH) {
  ctx.save();
  ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, PW * s, ph * s);
  if (paper === 'lined') {
    ctx.strokeStyle = 'rgba(37,99,235,.18)'; ctx.lineWidth = Math.max(1, 1.2 * s);
    for (let y = 120; y < ph - 20; y += 45) { ctx.beginPath(); ctx.moveTo(0, y * s); ctx.lineTo(PW * s, y * s); ctx.stroke(); }
    ctx.strokeStyle = 'rgba(200,55,47,.25)'; ctx.beginPath(); ctx.moveTo(90 * s, 0); ctx.lineTo(90 * s, ph * s); ctx.stroke();
  } else if (paper === 'grid') {
    ctx.strokeStyle = 'rgba(37,99,235,.12)'; ctx.lineWidth = Math.max(1, 1 * s);
    for (let x = 40; x < PW; x += 40) { ctx.beginPath(); ctx.moveTo(x * s, 0); ctx.lineTo(x * s, ph * s); ctx.stroke(); }
    for (let y = 40; y < ph; y += 40) { ctx.beginPath(); ctx.moveTo(0, y * s); ctx.lineTo(PW * s, y * s); ctx.stroke(); }
  } else if (paper === 'dots') {
    ctx.fillStyle = 'rgba(24,33,43,.22)';
    for (let x = 40; x < PW; x += 40) for (let y = 40; y < ph; y += 40) { ctx.beginPath(); ctx.arc(x * s, y * s, Math.max(1, 1.6 * s), 0, 7); ctx.fill(); }
  }
  ctx.restore();
}

const widthAt = (st, pr, s) => {
  if (st.t === 'hl') return HL.w * (st.w / 4) * s;
  return st.w * s * (st.pen ? 0.3 + 0.9 * (pr / 255) : 1);
};
// Draw one stroke. Points are [x, y, pressure(0–255)] repeated.
export function drawStroke(ctx, st, s) {
  const p = st.p, n = p.length / 3;
  if (!n) return;
  ctx.save();
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  ctx.strokeStyle = st.c; ctx.fillStyle = st.c;
  if (st.t === 'hl') { ctx.globalAlpha = HL.a; ctx.globalCompositeOperation = 'multiply'; }
  if (n === 1) {
    ctx.beginPath(); ctx.arc(p[0] * s, p[1] * s, widthAt(st, p[2], s) / 2, 0, 7); ctx.fill();
  } else if (st.t === 'hl') {
    // One path, so overlapping parts of a highlight don't get darker.
    ctx.lineWidth = widthAt(st, 128, s);
    ctx.beginPath(); ctx.moveTo(p[0] * s, p[1] * s);
    for (let i = 1; i < n; i++) ctx.lineTo(p[i * 3] * s, p[i * 3 + 1] * s);
    ctx.stroke();
  } else {
    // Smooth curve through the midpoints; each piece takes the width of its pressure.
    let px = p[0], py = p[1];
    for (let i = 1; i < n; i++) {
      const x = p[i * 3], y = p[i * 3 + 1];
      const mx = (px + x) / 2, my = (py + y) / 2;
      const prevMx = i === 1 ? p[0] : (p[(i - 2) * 3] + px) / 2, prevMy = i === 1 ? p[1] : (p[(i - 2) * 3 + 1] + py) / 2;
      ctx.lineWidth = widthAt(st, (p[i * 3 - 1] + p[i * 3 + 2]) / 2, s);
      ctx.beginPath(); ctx.moveTo(prevMx * s, prevMy * s); ctx.quadraticCurveTo(px * s, py * s, mx * s, my * s); ctx.stroke();
      px = x; py = y;
    }
    ctx.lineWidth = widthAt(st, p[(n - 1) * 3 + 2], s);
    ctx.beginPath(); ctx.moveTo(((p[(n - 2) * 3] + px) / 2) * s, ((p[(n - 2) * 3 + 1] + py) / 2) * s); ctx.lineTo(px * s, py * s); ctx.stroke();
  }
  ctx.restore();
}

// A page as an image (for thumbnails, downloads and handwriting-to-text).
export function pageCanvas(ink, page, width, ph = ink.ph || PH) {
  const s = width / PW;
  const c = document.createElement('canvas');
  c.width = Math.round(PW * s); c.height = Math.round(ph * s);
  const ctx = c.getContext('2d');
  drawPaper(ctx, ink.paper, s, ph);
  ink.strokes.filter(st => st.pg === page).forEach(st => drawStroke(ctx, st, s));
  return c;
}
export const pageImage = (ink, page, width, type = 'image/png', quality) => pageCanvas(ink, page, width).toDataURL(type, quality);
export const pageHasInk = (ink, page) => ink.strokes.some(st => st.pg === page);

/* ---------- the editor surface ---------- */
export class Pad {
  constructor(host, ink, { onChange, onPen } = {}) {
    this.host = host; this.ink = ink; this.ph = ink.ph || PH; this.onChange = onChange || (() => {}); this.onPen = onPen || (() => {});
    this.tool = 'pen'; this.color = COLORS[0]; this.width = 3;
    this.undoStack = []; this.redoStack = [];
    try { this.penOnly = localStorage.getItem('rl.penSeen') === '1'; } catch (e) { this.penOnly = false; }
    this.live = null; this.lastPen = 0;
    host.innerHTML = '';
    this.pages = [];
    for (let i = 0; i < ink.pages; i++) this.addPageEl();
    this.ro = new ResizeObserver(() => this.layout());
    this.ro.observe(host);
    this.bind();
    this.layout();
  }
  addPageEl() {
    const wrap = document.createElement('div');
    wrap.className = 'pad-page';
    const cv = document.createElement('canvas');
    cv.dataset.pg = this.pages.length;
    const num = document.createElement('span');
    num.className = 'pad-pnum'; num.textContent = this.pages.length + 1;
    wrap.append(cv, num);
    this.host.appendChild(wrap);
    this.pages.push(cv);
  }
  layout() {
    const w = Math.min(this.host.clientWidth - (this.ph < PH ? 0 : 24), 900);
    if (w <= 0) return;
    this.s = w / PW;
    const dpr = Math.min(window.devicePixelRatio || 1, 3);
    this.pages.forEach(cv => {
      cv.style.width = w + 'px'; cv.style.height = Math.round(this.ph * this.s) + 'px';
      cv.width = Math.round(PW * this.s * dpr); cv.height = Math.round(this.ph * this.s * dpr);
      cv.getContext('2d').setTransform(dpr, 0, 0, dpr, 0, 0);
      this.redraw(+cv.dataset.pg);
    });
  }
  redraw(pg) {
    const cv = this.pages[pg];
    if (!cv) return;
    const ctx = cv.getContext('2d');
    drawPaper(ctx, this.ink.paper, this.s, this.ph);
    this.ink.strokes.forEach(st => { if (st.pg === pg) drawStroke(ctx, st, this.s); });
  }
  redrawAll() { this.pages.forEach((_, i) => this.redraw(i)); }
  setPaper(p) { this.ink.paper = p; this.redrawAll(); this.changed(); }
  addPage() {
    this.ink.pages++; this.addPageEl(); this.layout(); this.changed();
    this.pages[this.pages.length - 1].scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
  changed() { this.onChange(); }

  pos(e, cv) {
    const r = cv.getBoundingClientRect();
    return [Math.round((e.clientX - r.left) / this.s), Math.round((e.clientY - r.top) / this.s), Math.round(255 * (e.pointerType === 'pen' ? (e.pressure || 0.5) : 0.5))];
  }
  bind() {
    const h = this.host;
    this.scroller = h.closest('.pad-scroll') || h.parentElement;
    h.addEventListener('pointerdown', e => this.down(e));
    h.addEventListener('pointermove', e => this.move(e));
    ['pointerup', 'pointercancel'].forEach(t => h.addEventListener(t, e => this.up(e)));
    h.addEventListener('contextmenu', e => e.preventDefault());
  }
  down(e) {
    const cv = e.target.closest && e.target.closest('canvas');
    if (e.pointerType === 'pen') {
      this.lastPen = Date.now();
      if (!this.penOnly) { this.penOnly = true; try { localStorage.setItem('rl.penSeen', '1'); } catch (err) {} this.onPen(true); }
    }
    // Fingers scroll while a pen is in use (palm rejection); two fingers always scroll.
    if (e.pointerType === 'touch' && (this.penOnly || Date.now() - this.lastPen < 800 || this.touchScroll)) {
      this.touchScroll = { id: e.pointerId, y: e.clientY, x: e.clientX };
      return;
    }
    if (!cv || this.live) return;
    e.preventDefault();
    h_capture(cv, e.pointerId);
    const pg = +cv.dataset.pg;
    const eraser = this.tool === 'eraser' || (e.pointerType === 'pen' && (e.buttons & 32)) || e.button === 5;
    if (eraser) { this.live = { erase: true, pg, cv, id: e.pointerId, removed: [] }; this.eraseAt(this.pos(e, cv), pg); return; }
    const st = { pg, t: this.tool === 'hl' ? 'hl' : 'pen', c: this.color, w: this.tool === 'hl' ? this.width : this.width, pen: e.pointerType === 'pen' ? 1 : 0, p: [] };
    this.live = { st, cv, id: e.pointerId };
    this.addPoints(e, cv, st);
  }
  move(e) {
    if (this.touchScroll && e.pointerId === this.touchScroll.id) {
      this.scroller.scrollBy(this.touchScroll.x - e.clientX, this.touchScroll.y - e.clientY);
      this.touchScroll.x = e.clientX; this.touchScroll.y = e.clientY;
      return;
    }
    const L = this.live;
    if (!L || e.pointerId !== L.id) return;
    e.preventDefault();
    if (L.erase) { coalesced(e).forEach(ev => this.eraseAt(this.pos(ev, L.cv), L.pg)); return; }
    this.addPoints(e, L.cv, L.st);
  }
  addPoints(e, cv, st) {
    const evs = e.type === 'pointermove' ? coalesced(e) : [e];
    const ctx = cv.getContext('2d');
    for (const ev of evs) {
      const [x, y, pr] = this.pos(ev, cv);
      const n = st.p.length / 3;
      if (n && Math.abs(st.p[(n - 1) * 3] - x) + Math.abs(st.p[(n - 1) * 3 + 1] - y) < 1) continue;
      st.p.push(x, y, pr);
      // Draw just the new piece while writing; the full stroke is redrawn smoothly at the end.
      const m = st.p.length / 3;
      if (st.t !== 'hl' && m >= 2) {
        ctx.save(); ctx.lineCap = 'round'; ctx.strokeStyle = st.c;
        ctx.lineWidth = widthAt(st, pr, this.s);
        ctx.beginPath(); ctx.moveTo(st.p[(m - 2) * 3] * this.s, st.p[(m - 2) * 3 + 1] * this.s); ctx.lineTo(x * this.s, y * this.s); ctx.stroke();
        ctx.restore();
      }
    }
    if (st.t === 'hl') { this.redraw(st.pg); drawStroke(ctx, st, this.s); }
  }
  up(e) {
    if (this.touchScroll && e.pointerId === this.touchScroll.id) { this.touchScroll = null; return; }
    const L = this.live;
    if (!L || e.pointerId !== L.id) return;
    this.live = null;
    if (L.erase) {
      if (L.removed.length) { this.undoStack.push({ del: L.removed }); this.redoStack = []; this.changed(); }
      return;
    }
    if (!L.st.p.length) return;
    this.ink.strokes.push(L.st);
    this.undoStack.push({ add: L.st }); this.redoStack = [];
    this.redraw(L.st.pg);
    this.changed();
  }
  eraseAt([x, y], pg) {
    const r = Math.max(14, this.width * 4);
    const L = this.live;
    for (let i = this.ink.strokes.length - 1; i >= 0; i--) {
      const st = this.ink.strokes[i];
      if (st.pg !== pg) continue;
      const pad = st.t === 'hl' ? HL.w / 2 : st.w;
      for (let j = 0; j < st.p.length; j += 3) {
        if (Math.abs(st.p[j] - x) < r + pad && Math.abs(st.p[j + 1] - y) < r + pad) {
          L.removed.push({ st, i });
          this.ink.strokes.splice(i, 1);
          this.redraw(pg);
          break;
        }
      }
    }
  }
  undo() {
    const op = this.undoStack.pop();
    if (!op) return false;
    if (op.add) { const i = this.ink.strokes.lastIndexOf(op.add); if (i >= 0) this.ink.strokes.splice(i, 1); this.redraw(op.add.pg); }
    if (op.del) { [...op.del].reverse().forEach(({ st, i }) => this.ink.strokes.splice(Math.min(i, this.ink.strokes.length), 0, st)); this.redrawAll(); }
    this.redoStack.push(op); this.changed(); return true;
  }
  redo() {
    const op = this.redoStack.pop();
    if (!op) return false;
    if (op.add) { this.ink.strokes.push(op.add); this.redraw(op.add.pg); }
    if (op.del) { op.del.forEach(({ st }) => { const i = this.ink.strokes.indexOf(st); if (i >= 0) this.ink.strokes.splice(i, 1); }); this.redrawAll(); }
    this.undoStack.push(op); this.changed(); return true;
  }
  clearPage(pg) {
    const removed = [];
    for (let i = this.ink.strokes.length - 1; i >= 0; i--) if (this.ink.strokes[i].pg === pg) { removed.push({ st: this.ink.strokes[i], i }); this.ink.strokes.splice(i, 1); }
    if (removed.length) { this.undoStack.push({ del: removed.reverse() }); this.redoStack = []; this.redraw(pg); this.changed(); }
  }
  visiblePage() {
    const top = this.scroller.getBoundingClientRect().top + 80;
    let best = 0;
    this.pages.forEach((cv, i) => { if (cv.getBoundingClientRect().top <= top) best = i; });
    return best;
  }
  destroy() { this.ro.disconnect(); this.host.innerHTML = ''; }
}
// All the in-between positions the stylus reported since the last frame (smoother lines).
function coalesced(e) { const l = e.getCoalescedEvents ? e.getCoalescedEvents() : []; return l && l.length ? l : [e]; }
function h_capture(el, id) { try { el.setPointerCapture(id); } catch (e) {} }
