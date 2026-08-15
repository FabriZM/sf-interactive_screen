/* A small QR encoder: byte mode, error correction level M, versions 1-10.
   That tops out at 213 bytes, which is a lot of LAN URL. Zero dependencies,
   like the rest of this thing — it runs the same in Node and in the page. */

// Per version 1-10 at level M: EC codewords per block, then the block groups
// as [count, data codewords]. Two groups because some versions mix sizes.
const BLOCKS_M = [
  [10, [[1, 16]]],
  [16, [[1, 28]]],
  [26, [[1, 44]]],
  [18, [[2, 32]]],
  [24, [[2, 43]]],
  [16, [[4, 27]]],
  [18, [[4, 31]]],
  [22, [[2, 38], [2, 39]]],
  [22, [[3, 36], [2, 37]]],
  [26, [[4, 43], [1, 44]]],
];

// Row/column centres of the alignment patterns, by version.
const ALIGN = [
  [], [6, 18], [6, 22], [6, 26], [6, 30],
  [6, 34], [6, 22, 38], [6, 24, 42], [6, 26, 46], [6, 28, 50],
];

// ------------------------------------------------------------- GF(256)

const EXP = new Uint8Array(512);
const LOG = new Uint8Array(256);
for (let i = 0, x = 1; i < 255; i++) {
  EXP[i] = x;
  LOG[x] = i;
  x <<= 1;
  if (x & 0x100) x ^= 0x11d; // the QR primitive polynomial
}
for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255];

function mul(a, b) {
  return a === 0 || b === 0 ? 0 : EXP[LOG[a] + LOG[b]];
}

// Generator polynomial for `degree` EC codewords: (x - a^0)...(x - a^degree-1).
function generator(degree) {
  let poly = [1];
  for (let i = 0; i < degree; i++) {
    const next = new Array(poly.length + 1).fill(0);
    for (let j = 0; j < poly.length; j++) {
      next[j] ^= poly[j];
      next[j + 1] ^= mul(poly[j], EXP[i]);
    }
    poly = next;
  }
  return poly;
}

// Reed-Solomon remainder: the EC codewords that follow a block of data.
function ecCodewords(data, ecLen) {
  const gen = generator(ecLen);
  const rem = new Uint8Array(ecLen);
  for (const byte of data) {
    const factor = byte ^ rem[0];
    rem.copyWithin(0, 1);
    rem[ecLen - 1] = 0;
    for (let i = 0; i < ecLen; i++) rem[i] ^= mul(gen[i + 1], factor);
  }
  return rem;
}

// --------------------------------------------------------------- bits

function bitsFor(version, bytes) {
  // Mode indicator, then a character count that widens at version 10.
  return 4 + (version < 10 ? 8 : 16) + bytes.length * 8;
}

function dataCapacity(version) {
  const [ecLen, groups] = BLOCKS_M[version - 1];
  return groups.reduce((n, [count, size]) => n + count * size, 0);
}

function pickVersion(bytes) {
  for (let v = 1; v <= 10; v++) {
    if (bitsFor(v, bytes) <= dataCapacity(v) * 8) return v;
  }
  throw new Error(`Too much data for a version-10 QR: ${bytes.length} bytes`);
}

function encodeData(bytes, version) {
  const total = dataCapacity(version);
  const bits = [];
  const push = (value, len) => {
    for (let i = len - 1; i >= 0; i--) bits.push((value >> i) & 1);
  };

  push(0b0100, 4); // byte mode
  push(bytes.length, version < 10 ? 8 : 16);
  for (const b of bytes) push(b, 8);

  // Terminator, then round up to a whole codeword.
  for (let i = 0; i < 4 && bits.length < total * 8; i++) bits.push(0);
  while (bits.length % 8) bits.push(0);

  const words = [];
  for (let i = 0; i < bits.length; i += 8) {
    words.push(bits.slice(i, i + 8).reduce((n, bit) => (n << 1) | bit, 0));
  }
  // The spec's filler: these two bytes, alternating, to the end.
  for (let i = 0; words.length < total; i++) words.push(i % 2 ? 0x11 : 0xec);
  return words;
}

// Split into blocks, add EC to each, then interleave — data first, then EC.
function interleave(words, version) {
  const [ecLen, groups] = BLOCKS_M[version - 1];
  const blocks = [];
  let at = 0;
  for (const [count, size] of groups) {
    for (let i = 0; i < count; i++) {
      const data = words.slice(at, at + size);
      at += size;
      blocks.push({ data, ec: ecCodewords(data, ecLen) });
    }
  }

  const out = [];
  const longest = Math.max(...blocks.map((b) => b.data.length));
  for (let i = 0; i < longest; i++) {
    for (const b of blocks) if (i < b.data.length) out.push(b.data[i]);
  }
  for (let i = 0; i < ecLen; i++) {
    for (const b of blocks) out.push(b.ec[i]);
  }
  return out;
}

// ------------------------------------------------------------ patterns

function makeGrid(size, value) {
  return Array.from({ length: size }, () => new Array(size).fill(value));
}

function drawFunctionPatterns(m, taken, version) {
  const size = m.length;
  const set = (x, y, on) => {
    if (x < 0 || y < 0 || x >= size || y >= size) return;
    m[y][x] = on ? 1 : 0;
    taken[y][x] = true;
  };

  // Finders, with their one-module separator, in three corners.
  for (const [ox, oy] of [[0, 0], [size - 7, 0], [0, size - 7]]) {
    for (let dy = -1; dy <= 7; dy++) {
      for (let dx = -1; dx <= 7; dx++) {
        const edge = Math.max(Math.abs(dx - 3), Math.abs(dy - 3));
        set(ox + dx, oy + dy, edge !== 2 && edge <= 3);
      }
    }
  }

  // Alignment patterns, minus the three that would sit on a finder.
  const centres = ALIGN[version - 1];
  for (const cy of centres) {
    for (const cx of centres) {
      const onFinder = (cx === 6 && cy === 6)
        || (cx === 6 && cy === size - 7) || (cx === size - 7 && cy === 6);
      if (onFinder) continue;
      for (let dy = -2; dy <= 2; dy++) {
        for (let dx = -2; dx <= 2; dx++) {
          set(cx + dx, cy + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
        }
      }
    }
  }

  // Timing: the dotted line joining the finders, row and column 6.
  for (let i = 8; i < size - 8; i++) {
    set(i, 6, i % 2 === 0);
    set(6, i, i % 2 === 0);
  }

  set(8, size - 8, true); // the always-dark module

  // Reserve the format strips; the real bits go in once a mask is chosen.
  for (let i = 0; i < 9; i++) {
    set(i, 8, false);
    set(8, i, false);
  }
  for (let i = 0; i < 8; i++) {
    set(size - 1 - i, 8, false);
    set(8, size - 1 - i, false);
  }

  if (version >= 7) {
    const bits = versionBits(version);
    for (let i = 0; i < 18; i++) {
      const on = ((bits >> i) & 1) === 1;
      const a = Math.floor(i / 3);
      const b = (i % 3) + size - 11;
      set(a, b, on);
      set(b, a, on);
    }
  }
}

// BCH(18,6) — the version number plus its error correction, for version 7+.
function versionBits(version) {
  let rem = version;
  for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25);
  return (version << 12) | rem;
}

// BCH(15,5) over the level and mask, then the spec's fixed XOR.
function formatBits(mask) {
  const data = (0b00 << 3) | mask; // 00 = level M
  let rem = data;
  for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
  return ((data << 10) | rem) ^ 0x5412;
}

function drawFormat(m, mask) {
  const size = m.length;
  const bits = formatBits(mask);
  const bit = (i) => (bits >> i) & 1;

  // Copy one: around the top-left finder, skipping the timing column/row.
  for (let i = 0; i <= 5; i++) m[i][8] = bit(i);
  m[7][8] = bit(6);
  m[8][8] = bit(7);
  m[8][7] = bit(8);
  for (let i = 9; i < 15; i++) m[8][14 - i] = bit(i);

  // Copy two: split between the other two finders.
  for (let i = 0; i < 8; i++) m[8][size - 1 - i] = bit(i);
  for (let i = 8; i < 15; i++) m[size - 15 + i][8] = bit(i);
}

// ---------------------------------------------------------- data + mask

// Two modules wide, bottom to top and back down again, right to left.
function placeData(m, taken, codewords) {
  const size = m.length;
  let bit = 0;
  const next = () => {
    const i = bit >> 3;
    const b = i < codewords.length ? (codewords[i] >> (7 - (bit & 7))) & 1 : 0;
    bit++;
    return b;
  };

  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5; // column 6 is timing; step over it
    const upward = ((right + 1) & 2) === 0;
    for (let step = 0; step < size; step++) {
      const y = upward ? size - 1 - step : step;
      for (const x of [right, right - 1]) {
        if (!taken[y][x]) m[y][x] = next();
      }
    }
  }
}

const MASKS = [
  (x, y) => (x + y) % 2 === 0,
  (x, y) => y % 2 === 0,
  (x, y) => x % 3 === 0,
  (x, y) => (x + y) % 3 === 0,
  (x, y) => (Math.floor(y / 2) + Math.floor(x / 3)) % 2 === 0,
  (x, y) => ((x * y) % 2) + ((x * y) % 3) === 0,
  (x, y) => (((x * y) % 2) + ((x * y) % 3)) % 2 === 0,
  (x, y) => (((x + y) % 2) + ((x * y) % 3)) % 2 === 0,
];

function applyMask(m, taken, mask) {
  const fn = MASKS[mask];
  for (let y = 0; y < m.length; y++) {
    for (let x = 0; x < m.length; x++) {
      if (!taken[y][x] && fn(x, y)) m[y][x] ^= 1;
    }
  }
}

// The four penalty rules from the spec: runs, blocks, finder lookalikes, and
// overall balance. Lowest score wins, which is how a mask gets picked.
function penalty(m) {
  const size = m.length;
  let score = 0;

  const runScore = (line) => {
    let n = 0;
    let run = 1;
    for (let i = 1; i <= line.length; i++) {
      if (i < line.length && line[i] === line[i - 1]) {
        run++;
      } else {
        if (run >= 5) n += run - 2;
        run = 1;
      }
    }
    return n;
  };

  const FINDER = [1, 0, 1, 1, 1, 0, 1, 0, 0, 0, 0];
  const hasFinder = (line, at) => {
    for (let i = 0; i < 11; i++) if (line[at + i] !== FINDER[i]) return false;
    return true;
  };

  for (let i = 0; i < size; i++) {
    const lines = [m[i], m.map((r) => r[i])];
    for (const line of lines) {
      score += runScore(line);
      // The 1:1:3:1:1 pattern with its quiet space, either way round.
      const back = line.slice().reverse();
      for (let j = 0; j + 11 <= size; j++) {
        if (hasFinder(line, j)) score += 40;
        if (hasFinder(back, j)) score += 40;
      }
    }
  }

  for (let y = 0; y + 1 < size; y++) {
    for (let x = 0; x + 1 < size; x++) {
      const v = m[y][x];
      if (v === m[y][x + 1] && v === m[y + 1][x] && v === m[y + 1][x + 1]) score += 3;
    }
  }

  const dark = m.flat().reduce((n, v) => n + v, 0);
  const ratio = (dark * 100) / (size * size);
  score += Math.floor(Math.abs(ratio - 50) / 5) * 10;

  return score;
}

// ---------------------------------------------------------------- api

// Returns { size, modules } where modules[y][x] is 1 for a dark module.
// No quiet zone — the renderer adds it.
function qrEncode(text) {
  const bytes = Array.from(new TextEncoder().encode(String(text)));
  const version = pickVersion(bytes);
  const size = 17 + version * 4;
  const codewords = interleave(encodeData(bytes, version), version);

  let best = null;
  for (let mask = 0; mask < 8; mask++) {
    const m = makeGrid(size, 0);
    const taken = makeGrid(size, false);
    drawFunctionPatterns(m, taken, version);
    placeData(m, taken, codewords);
    applyMask(m, taken, mask);
    drawFormat(m, mask);
    const score = penalty(m);
    if (!best || score < best.score) best = { score, modules: m };
  }

  return { size, modules: best.modules };
}

// An SVG of the code: one path for every dark module, so it scales cleanly
// and prints without a canvas anywhere in sight.
// `quiet` is the blank margin in modules; the spec asks for 4 and scanners
// really do want it.
function qrSvg(text, { quiet = 4, dark = '#000', light = '#fff' } = {}) {
  const { size, modules } = qrEncode(text);
  const side = size + quiet * 2;
  let d = '';
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (modules[y][x]) d += `M${x + quiet} ${y + quiet}h1v1h-1z`;
    }
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${side} ${side}" `
    + `shape-rendering="crispEdges" role="img" aria-label="QR code">`
    + `<rect width="${side}" height="${side}" fill="${light}"/>`
    + `<path d="${d}" fill="${dark}"/></svg>`;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { qrEncode, qrSvg };
}
