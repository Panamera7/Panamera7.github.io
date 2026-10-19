// Tests del detector sin navegador: node --test test/
const { test } = require('node:test');
const assert = require('node:assert');
const E = require('../escaner.js');

function dentro(p, poly) {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j];
    if ((a.y > p.y) !== (b.y > p.y) && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) c = !c;
  }
  return c;
}
// Hoja clara (con "texto" oscuro) sobre mesa de madera con ruido.
function escena(w, h, quad) {
  const d = new Uint8ClampedArray(w * h * 4);
  let seed = 7; const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const o = (y * w + x) * 4; const n = rnd() * 30 - 15;
    let r = 140 + n + 20 * Math.sin(x / 9), g = 95 + n, b = 60 + n;
    if (dentro({ x: x + 0.5, y: y + 0.5 }, quad)) { r = 235 + n / 2; g = 232 + n / 2; b = 225 + n / 2; if (y % 14 < 2 && x % 40 < 30) { r = g = b = 40; } }
    d[o] = r; d[o + 1] = g; d[o + 2] = b; d[o + 3] = 255;
  }
  return d;
}

test('detecta una hoja girada con perspectiva', () => {
  const w = 480, h = 360;
  const quad = [{ x: 120, y: 40 }, { x: 390, y: 70 }, { x: 360, y: 330 }, { x: 80, y: 300 }];
  const r = E.detectar(escena(w, h, quad), w, h);
  assert.ok(r.ok, JSON.stringify(r));
  r.puntos.forEach((p, i) => {
    const err = Math.hypot(p.x * w - quad[i].x, p.y * h - quad[i].y);
    assert.ok(err < 6, 'esquina ' + i + ' error ' + err.toFixed(1));
  });
});

test('sin documento -> ok=false y esquinas por defecto (nunca bloquea)', () => {
  const w = 200, h = 150, d = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < d.length; i += 4) { d[i] = 120; d[i + 1] = 90; d[i + 2] = 60; d[i + 3] = 255; }
  const r = E.detectar(d, w, h);
  assert.equal(r.ok, false);
  assert.equal(r.puntos.length, 4);
});

test('enderezar: un cuadrilátero vuelve a ser rectángulo', () => {
  const w = 300, h = 300;
  const quad = [{ x: 50, y: 30 }, { x: 260, y: 60 }, { x: 240, y: 270 }, { x: 30, y: 250 }];
  const src = escena(w, h, quad);
  const out = E.enderezar(src, w, h, quad, 200, 200);
  // las esquinas del resultado deben ser papel (claro), no madera
  for (const [x, y] of [[3, 3], [196, 3], [196, 196], [3, 196], [100, 100]]) {
    const o = (y * 200 + x) * 4; const sat = Math.max(out[o], out[o + 1], out[o + 2]) - Math.min(out[o], out[o + 1], out[o + 2]);
    assert.ok(sat < 30 || out[o] < 60, 'pixel ' + x + ',' + y + ' parece fondo: ' + out[o] + ',' + out[o + 1] + ',' + out[o + 2]);
  }
});

test('homografía exacta en las 4 esquinas', () => {
  const de = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 5 }, { x: 0, y: 5 }];
  const a = [{ x: 3, y: 1 }, { x: 20, y: 4 }, { x: 18, y: 15 }, { x: 1, y: 12 }];
  const H = E.homografia(de, a);
  de.forEach((p, i) => { const z = H[6] * p.x + H[7] * p.y + 1; assert.ok(Math.abs((H[0] * p.x + H[1] * p.y + H[2]) / z - a[i].x) < 1e-6); });
});

test('proporción real de un A4 fotografiado inclinado (cámara estenopeica, f=3000 px)', () => {
  // esquinas proyectadas de una hoja 210x297 mm girada 28°/9°/-6° a 47 cm (ver gestoria-escaner/genera.py)
  const q = [{ x: 1008, y: 1018 }, { x: 2538, y: 1309 }, { x: 1978, y: 2887 }, { x: 826, y: 2737 }];
  const r = E.proporcionReal(q, 3024, 4032);
  assert.ok(Math.abs(r - 210 / 297) < 0.01, 'proporción ' + r);
  const t = E.tamanoSalida(q, 1600, 3024, 4032);
  assert.equal(t.h, 1600);
  assert.ok(Math.abs(t.w / t.h - 210 / 297) < 0.01);
  // sin perspectiva: se usa la medida por lados
  assert.deepEqual(E.tamanoSalida([{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 200 }, { x: 0, y: 200 }], 1600, 300, 300), { w: 100, h: 200 });
});
