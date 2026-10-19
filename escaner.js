/* GestorIA · Escáner de documentos sin dependencias (funciona sin conexión).
 * detectar(): busca la hoja/ticket (claro y poco saturado) sobre el fondo y devuelve 4 esquinas.
 * enderezar(): corrige la perspectiva (homografía + interpolación bilineal).
 * Se puede usar en el navegador (window.Escaner) y en Node (require) para tests. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Escaner = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // Puntuación por píxel: brillo menos saturación. El papel es claro y casi gris.
  function puntuar(data, n) {
    const out = new Float32Array(n);
    for (let i = 0, p = 0; i < n; i++, p += 4) {
      const r = data[p], g = data[p + 1], b = data[p + 2];
      const mx = r > g ? (r > b ? r : b) : (g > b ? g : b);
      const mn = r < g ? (r < b ? r : b) : (g < b ? g : b);
      out[i] = mx - 0.8 * (mx - mn);
    }
    return out;
  }

  function desenfocar(src, w, h) { // caja 5x5 separable
    const tmp = new Float32Array(w * h), out = new Float32Array(w * h), R = 2;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        let s = 0, c = 0;
        for (let k = -R; k <= R; k++) { const xx = x + k; if (xx >= 0 && xx < w) { s += src[y * w + xx]; c++; } }
        tmp[y * w + x] = s / c;
      }
    }
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        let s = 0, c = 0;
        for (let k = -R; k <= R; k++) { const yy = y + k; if (yy >= 0 && yy < h) { s += tmp[yy * w + x]; c++; } }
        out[y * w + x] = s / c;
      }
    }
    return out;
  }

  function otsu(v) {
    const hist = new Float64Array(256);
    for (let i = 0; i < v.length; i++) { let b = v[i] | 0; if (b < 0) b = 0; if (b > 255) b = 255; hist[b]++; }
    const total = v.length; let sum = 0;
    for (let i = 0; i < 256; i++) sum += i * hist[i];
    let sumB = 0, wB = 0, best = 0, t = 127;
    for (let i = 0; i < 256; i++) {
      wB += hist[i]; if (!wB) continue;
      const wF = total - wB; if (!wF) break;
      sumB += i * hist[i];
      const mB = sumB / wB, mF = (sum - sumB) / wF;
      const between = wB * wF * (mB - mF) * (mB - mF);
      if (between > best) { best = between; t = i; }
    }
    return t;
  }

  // Componente conexa más grande (4-vecindad) de la máscara.
  function mayorComponente(mask, w, h) {
    const label = new Int32Array(w * h), stack = new Int32Array(w * h);
    let bestLabel = 0, bestArea = 0, cur = 0;
    for (let i = 0; i < w * h; i++) {
      if (!mask[i] || label[i]) continue;
      cur++; let sp = 0, area = 0; stack[sp++] = i; label[i] = cur;
      while (sp) {
        const p = stack[--sp]; area++;
        const x = p % w, y = (p - x) / w;
        if (x > 0 && mask[p - 1] && !label[p - 1]) { label[p - 1] = cur; stack[sp++] = p - 1; }
        if (x < w - 1 && mask[p + 1] && !label[p + 1]) { label[p + 1] = cur; stack[sp++] = p + 1; }
        if (y > 0 && mask[p - w] && !label[p - w]) { label[p - w] = cur; stack[sp++] = p - w; }
        if (y < h - 1 && mask[p + w] && !label[p + w]) { label[p + w] = cur; stack[sp++] = p + w; }
      }
      if (area > bestArea) { bestArea = area; bestLabel = cur; }
    }
    return { label, id: bestLabel, area: bestArea };
  }

  function cruz(o, a, b) { return (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x); }
  function envolvente(pts) { // cadena monótona
    pts = pts.slice().sort((a, b) => a.x - b.x || a.y - b.y);
    if (pts.length < 3) return pts;
    const lo = [], hi = [];
    for (const p of pts) { while (lo.length >= 2 && cruz(lo[lo.length - 2], lo[lo.length - 1], p) <= 0) lo.pop(); lo.push(p); }
    for (let i = pts.length - 1; i >= 0; i--) { const p = pts[i]; while (hi.length >= 2 && cruz(hi[hi.length - 2], hi[hi.length - 1], p) <= 0) hi.pop(); hi.push(p); }
    lo.pop(); hi.pop();
    return lo.concat(hi);
  }
  function areaPoligono(p) {
    let a = 0;
    for (let i = 0; i < p.length; i++) { const j = (i + 1) % p.length; a += p[i].x * p[j].y - p[j].x * p[i].y; }
    return Math.abs(a) / 2;
  }
  function areaTri(a, b, c) { return Math.abs(cruz(a, b, c)) / 2; }

  // Cuadrilátero de área máxima con vértices en la envolvente convexa.
  function mejorCuadrilatero(hull) {
    let H = hull;
    if (H.length > 90) { const step = H.length / 90; H = []; for (let i = 0; i < 90; i++) H.push(hull[Math.floor(i * step)]); }
    const n = H.length;
    if (n < 4) return null;
    let best = -1, q = null;
    for (let i = 0; i < n; i++) {
      for (let k = i + 2; k < n; k++) {
        let b1 = -1, j1 = -1;
        for (let j = i + 1; j < k; j++) { const a = areaTri(H[i], H[j], H[k]); if (a > b1) { b1 = a; j1 = j; } }
        let b2 = -1, l1 = -1;
        for (let l = k + 1; l < n + i; l++) { const L = l % n; if (L === i) continue; const a = areaTri(H[k], H[L], H[i]); if (a > b2) { b2 = a; l1 = L; } }
        if (j1 < 0 || l1 < 0) continue;
        if (b1 + b2 > best) { best = b1 + b2; q = [H[i], H[j1], H[k], H[l1]]; }
      }
    }
    return q;
  }

  // Orden: arriba-izq, arriba-der, abajo-der, abajo-izq.
  function ordenar(pts) {
    const cx = pts.reduce((s, p) => s + p.x, 0) / pts.length, cy = pts.reduce((s, p) => s + p.y, 0) / pts.length;
    const s = pts.slice().sort((a, b) => Math.atan2(a.y - cy, a.x - cx) - Math.atan2(b.y - cy, b.x - cx));
    let k = 0; for (let i = 1; i < 4; i++) if (s[i].x + s[i].y < s[k].x + s[k].y) k = i;
    return [s[k], s[(k + 1) % 4], s[(k + 2) % 4], s[(k + 3) % 4]];
  }

  function esquinasPorDefecto() { return [{ x: 0.05, y: 0.05 }, { x: 0.95, y: 0.05 }, { x: 0.95, y: 0.95 }, { x: 0.05, y: 0.95 }]; }

  /** data: RGBA (Uint8ClampedArray) de una imagen reducida (~400-500 px). Devuelve esquinas normalizadas 0..1. */
  function detectar(data, w, h) {
    const fallo = (motivo) => ({ ok: false, motivo, confianza: 0, puntos: esquinasPorDefecto() });
    try {
      if (!w || !h || w < 16 || h < 16) return fallo('imagen pequeña');
      const n = w * h;
      const v = desenfocar(puntuar(data, n), w, h);
      const t = otsu(v);
      const mask = new Uint8Array(n);
      for (let i = 0; i < n; i++) mask[i] = v[i] > t ? 1 : 0;
      const comp = mayorComponente(mask, w, h);
      const frac = comp.area / n;
      if (frac < 0.06) return fallo('no se ve el documento');
      if (frac > 0.97) return fallo('el documento ocupa toda la foto');
      const pts = [];
      for (let y = 0; y < h; y++) {
        let a = -1, b = -1;
        for (let x = 0; x < w; x++) if (comp.label[y * w + x] === comp.id) { if (a < 0) a = x; b = x; }
        if (a >= 0) { pts.push({ x: a, y }); pts.push({ x: b + 1, y }); pts.push({ x: a, y: y + 1 }); pts.push({ x: b + 1, y: y + 1 }); }
      }
      const hull = envolvente(pts);
      const quad = mejorCuadrilatero(hull);
      if (!quad) return fallo('sin contorno');
      const aq = areaPoligono(quad), ah = areaPoligono(hull);
      const rect = comp.area / aq;          // ~1 si la mancha es un cuadrilátero
      const ajuste = aq / ah;               // ~1 si la envolvente es casi un cuadrilátero
      const confianza = Math.max(0, Math.min(1, Math.min(rect, 1) * ajuste));
      const puntos = ordenar(quad).map((p) => ({ x: Math.min(1, Math.max(0, p.x / w)), y: Math.min(1, Math.max(0, p.y / h)) }));
      if (aq / n < 0.08 || confianza < 0.75) return { ok: false, motivo: 'contorno dudoso', confianza, puntos };
      return { ok: true, confianza, puntos, umbral: t };
    } catch (e) { return fallo('error: ' + e.message); }
  }

  // Resuelve A·x = b (8x8) por Gauss con pivoteo.
  function resolver(A, b) {
    const n = b.length;
    for (let c = 0; c < n; c++) {
      let p = c; for (let r = c + 1; r < n; r++) if (Math.abs(A[r][c]) > Math.abs(A[p][c])) p = r;
      [A[c], A[p]] = [A[p], A[c]]; [b[c], b[p]] = [b[p], b[c]];
      if (Math.abs(A[c][c]) < 1e-12) throw new Error('esquinas degeneradas');
      for (let r = c + 1; r < n; r++) { const f = A[r][c] / A[c][c]; for (let k = c; k < n; k++) A[r][k] -= f * A[c][k]; b[r] -= f * b[c]; }
    }
    const x = new Array(n).fill(0);
    for (let r = n - 1; r >= 0; r--) { let s = b[r]; for (let k = r + 1; k < n; k++) s -= A[r][k] * x[k]; x[r] = s / A[r][r]; }
    return x;
  }
  /** Homografía que lleva los puntos 'de' a 'a' (4 pares). */
  function homografia(de, a) {
    const A = [], b = [];
    for (let i = 0; i < 4; i++) {
      const { x, y } = de[i], u = a[i].x, v = a[i].y;
      A.push([x, y, 1, 0, 0, 0, -u * x, -u * y]); b.push(u);
      A.push([0, 0, 0, x, y, 1, -v * x, -v * y]); b.push(v);
    }
    const h = resolver(A, b); h.push(1); return h;
  }

  const dist = (p, q) => Math.hypot(p.x - q.x, p.y - q.y);
  const x3 = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const d3 = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  /** Proporción real ancho/alto del documento (Zhang & He, 2007), estimando la focal desde el cuadrilátero.
   *  q en píxeles (TL,TR,BR,BL); sw, sh tamaño de la imagen (el centro óptico se supone en el centro). Null si no se puede. */
  function proporcionReal(q, sw, sh) {
    if (!sw || !sh) return null;
    const c = (p) => [p.x - sw / 2, p.y - sh / 2, 1];
    const m1 = c(q[0]), m2 = c(q[1]), m3 = c(q[3]), m4 = c(q[2]);
    const k2 = d3(x3(m1, m4), m3) / d3(x3(m2, m4), m3), k3 = d3(x3(m1, m4), m2) / d3(x3(m3, m4), m2);
    const n2 = [k2 * m2[0] - m1[0], k2 * m2[1] - m1[1], k2 * m2[2] - m1[2]];
    const n3 = [k3 * m3[0] - m1[0], k3 * m3[1] - m1[1], k3 * m3[2] - m1[2]];
    if (!isFinite(k2) || !isFinite(k3)) return null;
    const den = n2[2] * n3[2];
    if (Math.abs(den) < 1e-9) return null; // casi sin perspectiva: vale la medida por lados
    const f2 = -(n2[0] * n3[0] + n2[1] * n3[1]) / den;
    if (!(f2 > 0)) return null;
    const f = Math.sqrt(f2), dim = Math.max(sw, sh);
    if (f < 0.3 * dim || f > 6 * dim) return null; // focal inverosímil para un móvil
    const r = Math.sqrt((n2[0] * n2[0] + n2[1] * n2[1] + f2 * n2[2] * n2[2]) / (n3[0] * n3[0] + n3[1] * n3[1] + f2 * n3[2] * n3[2]));
    return isFinite(r) && r > 0.05 && r < 20 ? r : null;
  }
  /** Tamaño de salida para un cuadrilátero (en píxeles de origen), limitado a maxLado.
   *  Con sw/sh corrige la proporción por perspectiva (si no, una hoja inclinada sale achatada). */
  function tamanoSalida(q, maxLado, sw, sh) {
    let w = Math.max(dist(q[0], q[1]), dist(q[3], q[2])), h = Math.max(dist(q[0], q[3]), dist(q[1], q[2]));
    const r = proporcionReal(q, sw, sh), rLados = w / h;
    if (r && r / rLados < 2 && rLados / r < 2) { if (r >= rLados) h = w / r; else w = h * r; }
    const f = Math.min(1, maxLado / Math.max(w, h));
    return { w: Math.max(1, Math.round(w * f)), h: Math.max(1, Math.round(h * f)) };
  }

  /** Endereza: src RGBA (sw x sh), quad en píxeles de src (TL,TR,BR,BL) -> RGBA dw x dh. */
  function enderezar(src, sw, sh, quad, dw, dh) {
    const H = homografia([{ x: 0, y: 0 }, { x: dw, y: 0 }, { x: dw, y: dh }, { x: 0, y: dh }], quad);
    const out = new Uint8ClampedArray(dw * dh * 4);
    for (let v = 0; v < dh; v++) {
      for (let u = 0; u < dw; u++) {
        const uu = u + 0.5, vv = v + 0.5;
        const z = H[6] * uu + H[7] * vv + 1;
        let x = (H[0] * uu + H[1] * vv + H[2]) / z - 0.5, y = (H[3] * uu + H[4] * vv + H[5]) / z - 0.5;
        if (x < 0) x = 0; if (y < 0) y = 0; if (x > sw - 1) x = sw - 1; if (y > sh - 1) y = sh - 1;
        const x0 = x | 0, y0 = y | 0, x1 = x0 + 1 < sw ? x0 + 1 : x0, y1 = y0 + 1 < sh ? y0 + 1 : y0;
        const fx = x - x0, fy = y - y0;
        const p00 = (y0 * sw + x0) * 4, p10 = (y0 * sw + x1) * 4, p01 = (y1 * sw + x0) * 4, p11 = (y1 * sw + x1) * 4;
        const o = (v * dw + u) * 4;
        for (let c = 0; c < 3; c++) {
          const top = src[p00 + c] + (src[p10 + c] - src[p00 + c]) * fx;
          const bot = src[p01 + c] + (src[p11 + c] - src[p01 + c]) * fx;
          out[o + c] = top + (bot - top) * fy;
        }
        out[o + 3] = 255;
      }
    }
    return out;
  }

  return { detectar, enderezar, homografia, tamanoSalida, proporcionReal, ordenar, esquinasPorDefecto };
});
