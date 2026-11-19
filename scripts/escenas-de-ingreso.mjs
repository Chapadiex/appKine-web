// Genera las escenas con personas de public/acceso (19/11/2026). Uso: node scripts/escenas-de-ingreso.mjs public/acceso
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

const destino = process.argv[2];
const pts = (a) => a.map(([x, y], i) => `${i ? 'L' : 'M'}${x} ${y}`).join(' ');
const lerp = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];

function brazo([h, c, m], p) {
  const manga = lerp(h, c, 0.55);
  return `
    <path d="${pts([h, c, m])}" stroke="${p.piel}" stroke-width="10"/>
    <path d="${pts([h, manga])}" stroke="${p.remera}" stroke-width="15"/>
    <circle cx="${m[0]}" cy="${m[1]}" r="6" fill="${p.piel}"/>`;
}

function pierna([c, r, t], p, { descalzo = false } = {}) {
  const lado = t[0] >= c[0] ? 1 : -1;
  const pie = descalzo
    ? `<ellipse cx="${t[0] + lado * 3}" cy="${t[1] + 2}" rx="8" ry="5" fill="${p.piel}"/>`
    : `<rect x="${t[0] - 11 + lado * 4}" y="${t[1] - 2}" width="22" height="10" rx="5" fill="${p.zapatilla}"/>
       <rect x="${t[0] - 11 + lado * 4}" y="${t[1] + 6}" width="22" height="3" rx="1.5" fill="#94a3b8"/>`;
  return `
    <path d="${pts([c, r, t])}" stroke="${p.pantalon}" stroke-width="17"/>
    ${pie}`;
}

function pelo(p) {
  const tapa = 'M-15 60 C-17 38 17 38 15 60 C12 50 6 46 0 47 C-6 46 -12 50 -15 60 Z';
  switch (p.peinado) {
    case 'cola':
      return `<ellipse cx="17" cy="54" rx="6" ry="13" fill="${p.pelo}" transform="rotate(-24 17 54)"/>
              <path d="${tapa}" fill="${p.pelo}"/>`;
    case 'rodete':
      return `<circle cx="0" cy="40" r="8" fill="${p.pelo}"/><path d="${tapa}" fill="${p.pelo}"/>`;
    case 'rulos':
      return [
        [-12, 50],
        [-6, 44],
        [2, 42],
        [9, 45],
        [13, 51],
        [-14, 57],
        [15, 57],
      ]
        .map(([x, y]) => `<circle cx="${x}" cy="${y}" r="7" fill="${p.pelo}"/>`)
        .join('');
    default:
      return `<path d="M-15 58 C-16 41 16 41 15 58 C12 52 4 50 -2 51 C-8 51 -13 53 -15 58 Z" fill="${p.pelo}"/>`;
  }
}

/** Figura de pie; `x` traslada horizontalmente, las y son absolutas (suelo en ~262). */
function persona(p) {
  const piernas = [p.piernaAtras, p.piernaAdelante].filter(Boolean);
  return `<g transform="translate(${p.x} 0)" stroke-linecap="round" stroke-linejoin="round">
    ${piernas.map(([l, o]) => pierna(l, p, o)).join('')}
    <path d="M-23 144 L23 144 L25 166 Q0 171 -25 166 Z" fill="${p.pantalon}"/>
    ${p.brazoAtras ? brazo(p.brazoAtras, p) : ''}
    <path d="M-22 86 Q-27 87 -27 98 L-23 150 Q0 156 23 150 L27 98 Q27 87 22 86 Q0 80 -22 86 Z" fill="${p.remera}"/>
    <path d="M6 83 Q22 84 26 92 L27 98 L23 150 Q15 153 6 154 Z" fill="#000" fill-opacity=".1"/>
    ${p.brazos.map((b) => brazo(b, p)).join('')}
    <rect x="-5" y="72" width="10" height="13" rx="4" fill="${p.sombra}"/>
    <circle cx="-14" cy="63" r="3.5" fill="${p.sombra}"/>
    <circle cx="14" cy="63" r="3.5" fill="${p.sombra}"/>
    <ellipse cx="0" cy="60" rx="14" ry="16" fill="${p.piel}"/>
    ${pelo(p)}
  </g>`;
}

const svg = (cuerpo) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 320" fill="none">\n${cuerpo}\n</svg>\n`;

const clara = { piel: '#f2c094', sombra: '#dba274' };
const media = { piel: '#c68642', sombra: '#a86d32' };
const oscura = { piel: '#8d5524', sombra: '#723f17' };

const escenas = {
  'estiramiento.svg': svg(`
  <circle cx="200" cy="146" r="120" fill="#fff" fill-opacity=".08"/>
  <circle cx="306" cy="68" r="24" fill="#fde68a" fill-opacity=".5"/>
  <circle cx="96" cy="92" r="9" fill="#f9a8d4" fill-opacity=".6"/>
  <path d="M74 264 l6 -32 h28 l6 32 z" fill="#fb923c"/>
  <ellipse cx="82" cy="208" rx="9" ry="23" fill="#34d399" transform="rotate(-24 82 208)"/>
  <ellipse cx="106" cy="204" rx="9" ry="25" fill="#10b981" transform="rotate(20 106 204)"/>
  <ellipse cx="94" cy="196" rx="8" ry="27" fill="#6ee7b7"/>
  <rect x="128" y="262" width="150" height="10" rx="5" fill="#22d3ee"/>
  ${persona({
    x: 203,
    ...clara,
    pelo: '#5b2a12',
    peinado: 'cola',
    remera: '#fbbf24',
    pantalon: '#1e1b4b',
    zapatilla: '#f43f5e',
    piernaAtras: [
      [
        [-11, 158],
        [-13, 206],
        [-15, 252],
      ],
    ],
    piernaAdelante: [
      [
        [11, 158],
        [13, 206],
        [15, 252],
      ],
    ],
    brazos: [
      [
        [-21, 93],
        [-36, 62],
        [-44, 32],
      ],
      [
        [21, 93],
        [36, 62],
        [44, 32],
      ],
    ],
  })}`),

  'paralelas.svg': svg(`
  <circle cx="200" cy="140" r="116" fill="#fff" fill-opacity=".08"/>
  <circle cx="86" cy="78" r="16" fill="#a5f3fc" fill-opacity=".45"/>
  <circle cx="318" cy="104" r="7" fill="#fde68a" fill-opacity=".7"/>
  <rect x="80" y="266" width="240" height="7" rx="3.5" fill="#fff" fill-opacity=".25"/>
  <path d="M112 146 H288 M120 146 V266 M280 146 V266" stroke="#cbd5e1" stroke-width="7" stroke-linecap="round"/>
  ${persona({
    x: 200,
    ...oscura,
    pelo: '#111827',
    peinado: 'rulos',
    remera: '#34d399',
    pantalon: '#1e3a8a',
    zapatilla: '#f8fafc',
    piernaAtras: [
      [
        [10, 158],
        [16, 206],
        [24, 252],
      ],
    ],
    piernaAdelante: [
      [
        [-10, 158],
        [-18, 204],
        [-24, 252],
      ],
    ],
    brazos: [
      [
        [-21, 94],
        [-38, 124],
        [-50, 150],
      ],
      [
        [21, 94],
        [38, 124],
        [50, 150],
      ],
    ],
  })}
  <path d="M100 154 H300" stroke="#f8fafc" stroke-width="8" stroke-linecap="round"/>
  <path d="M108 154 V270 M292 154 V270" stroke="#e2e8f0" stroke-width="8" stroke-linecap="round"/>
  <circle cx="150" cy="152" r="6.5" fill="${oscura.piel}"/>
  <circle cx="250" cy="152" r="6.5" fill="${oscura.piel}"/>`),

  'equilibrio.svg': svg(`
  <circle cx="200" cy="128" r="106" fill="#fde047" fill-opacity=".28"/>
  <circle cx="200" cy="128" r="74" fill="#fff" fill-opacity=".1"/>
  <circle cx="84" cy="200" r="7" fill="#fff" fill-opacity=".5"/>
  <circle cx="320" cy="64" r="5" fill="#fff" fill-opacity=".6"/>
  <circle cx="312" cy="206" r="11" fill="#fecaca" fill-opacity=".5"/>
  <rect x="140" y="262" width="120" height="10" rx="5" fill="#a78bfa"/>
  ${persona({
    x: 200,
    ...media,
    pelo: '#1c1917',
    peinado: 'rodete',
    remera: '#f472b6',
    pantalon: '#312e81',
    zapatilla: '#312e81',
    piernaAtras: [
      [
        [10, 158],
        [36, 184],
        [-1, 199],
      ],
      { descalzo: true },
    ],
    piernaAdelante: [
      [
        [-4, 158],
        [-4, 206],
        [-4, 252],
      ],
      { descalzo: true },
    ],
    brazos: [
      [
        [-21, 93],
        [-32, 58],
        [-5, 26],
      ],
      [
        [21, 93],
        [32, 58],
        [5, 26],
      ],
    ],
  })}`),

  'pelota.svg': svg(`
  <circle cx="200" cy="146" r="118" fill="#fff" fill-opacity=".08"/>
  <circle cx="308" cy="72" r="13" fill="#fde68a" fill-opacity=".55"/>
  <circle cx="86" cy="98" r="18" fill="#c4b5fd" fill-opacity=".4"/>
  <path d="M292 262 H326" stroke="#e2e8f0" stroke-width="6" stroke-linecap="round"/>
  <rect x="286" y="250" width="12" height="22" rx="4" fill="#f472b6"/>
  <rect x="320" y="250" width="12" height="22" rx="4" fill="#f472b6"/>
  <ellipse cx="190" cy="268" rx="84" ry="6" fill="#000" fill-opacity=".14"/>
  <circle cx="150" cy="228" r="38" fill="#fb7185"/>
  <path d="M124 212 A28 28 0 0 1 150 199" stroke="#fff" stroke-opacity=".6" stroke-width="6" stroke-linecap="round"/>
  ${persona({
    x: 214,
    ...clara,
    pelo: '#b45309',
    peinado: 'corto',
    remera: '#38bdf8',
    pantalon: '#1e293b',
    zapatilla: '#f8fafc',
    piernaAtras: [
      [
        [11, 158],
        [13, 206],
        [15, 252],
      ],
    ],
    piernaAdelante: [
      [
        [-11, 158],
        [-13, 206],
        [-15, 252],
      ],
    ],
    brazos: [
      [
        [-21, 94],
        [-34, 134],
        [-48, 187],
      ],
      [
        [21, 94],
        [38, 122],
        [24, 146],
      ],
    ],
  })}`),
};

for (const [nombre, contenido] of Object.entries(escenas)) {
  writeFileSync(join(destino, nombre), contenido);
}
console.log(Object.keys(escenas).join(', '));
