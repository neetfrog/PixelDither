// ─────────────────────────────────────────────────────────────────────────────
//  Dithering Engine
//  Runs entirely on an OffscreenCanvas / regular Canvas via ImageData
// ─────────────────────────────────────────────────────────────────────────────

export type DitherAlgorithm =
  | 'none'
  | 'floyd_steinberg'
  | 'atkinson'
  | 'jarvis'
  | 'sierra'
  | 'sierra_lite'
  | 'stucki'
  | 'bayer2'
  | 'bayer4'
  | 'bayer8'
  | 'bayer16'
  | 'checkerboard'
  | 'pattern2x2'
  | 'noise'
  | 'blue_noise';

export interface ProcessOptions {
  palette: string[];           // hex colors
  algorithm: DitherAlgorithm;
  pixelSize: number;           // 1–64
  brightness: number;          // -100 to 100
  contrast: number;            // -100 to 100
  saturation: number;          // -100 to 100
  localContrast: number;       // -100 to 100 (unsharp mask)
  ditherStrength: number;      // 0.0 – 1.0
  aspectRatio: '1:1' | '1:2' | '2:1'; // pixel shape
  glitch: GlitchOptions;
}

export interface GlitchOptions {
  rgbShift: number;      // 0–20 px
  scanlines: boolean;
  pixelScatter: number;  // 0–10
  interlace: boolean;
  vhsBlur: number;       // 0–10
}

// ── Color utilities ───────────────────────────────────────────────────────────

function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.replace('#', ''), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function clamp(v: number): number {
  return Math.max(0, Math.min(255, Math.round(v)));
}

function colorDistSq(
  r1: number, g1: number, b1: number,
  r2: number, g2: number, b2: number
): number {
  const dr = r1 - r2, dg = g1 - g2, db = b1 - b2;
  // Weighted Euclidean (perceptual)
  return 2 * dr * dr + 4 * dg * dg + 3 * db * db;
}

function nearestColor(
  r: number, g: number, b: number,
  palette: Array<[number, number, number]>
): [number, number, number] {
  let best = palette[0];
  let bestDist = Infinity;
  for (const c of palette) {
    const d = colorDistSq(r, g, b, c[0], c[1], c[2]);
    if (d < bestDist) { bestDist = d; best = c; }
  }
  return best;
}

// ── Image adjustments ─────────────────────────────────────────────────────────

function applyAdjustments(
  data: Uint8ClampedArray,
  brightness: number,
  contrast: number,
  saturation: number,
  localContrast: number,
  width: number,
  height: number
): Uint8ClampedArray {
  const out = new Uint8ClampedArray(data);

  // Brightness / contrast
  const bFactor = brightness / 100;
  const cFactor = (259 * (contrast + 255)) / (255 * (259 - contrast));

  for (let i = 0; i < out.length; i += 4) {
    let r = out[i], g = out[i + 1], b = out[i + 2];

    // Brightness
    r += bFactor * 255;
    g += bFactor * 255;
    b += bFactor * 255;

    // Contrast
    r = cFactor * (r - 128) + 128;
    g = cFactor * (g - 128) + 128;
    b = cFactor * (b - 128) + 128;

    // Saturation via HSL-ish approximation
    if (saturation !== 0) {
      const gray = 0.299 * r + 0.587 * g + 0.114 * b;
      const s = 1 + saturation / 100;
      r = gray + s * (r - gray);
      g = gray + s * (g - gray);
      b = gray + s * (b - gray);
    }

    out[i]     = clamp(r);
    out[i + 1] = clamp(g);
    out[i + 2] = clamp(b);
  }

  // Local contrast / unsharp mask
  if (localContrast !== 0) {
    const blurred = gaussianBlur(out, width, height, 2);
    const strength = localContrast / 100;
    for (let i = 0; i < out.length; i += 4) {
      for (let c = 0; c < 3; c++) {
        const idx = i + c;
        out[idx] = clamp(out[idx] + strength * (out[idx] - blurred[idx]));
      }
    }
  }

  return out;
}

function gaussianBlur(
  data: Uint8ClampedArray, w: number, h: number, _radius: number
): Uint8ClampedArray {
  const kernel = [1, 2, 1, 2, 4, 2, 1, 2, 1];
  const kSum = 16;
  const out = new Uint8ClampedArray(data.length);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let r = 0, g = 0, b = 0;
      let ki = 0;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const nx = Math.max(0, Math.min(w - 1, x + dx));
          const ny = Math.max(0, Math.min(h - 1, y + dy));
          const ni = (ny * w + nx) * 4;
          const k = kernel[ki++];
          r += data[ni] * k;
          g += data[ni + 1] * k;
          b += data[ni + 2] * k;
        }
      }
      const oi = (y * w + x) * 4;
      out[oi]     = r / kSum;
      out[oi + 1] = g / kSum;
      out[oi + 2] = b / kSum;
      out[oi + 3] = data[oi + 3];
    }
  }
  return out;
}

// ── Bayer matrices ────────────────────────────────────────────────────────────

const BAYER2 = [[0, 2], [3, 1]];

const BAYER4 = [
  [0,  8,  2, 10],
  [12,  4, 14,  6],
  [3,  11,  1,  9],
  [15,  7, 13,  5],
];

const BAYER8 = [
  [ 0, 32,  8, 40,  2, 34, 10, 42],
  [48, 16, 56, 24, 50, 18, 58, 26],
  [12, 44,  4, 36, 14, 46,  6, 38],
  [60, 28, 52, 20, 62, 30, 54, 22],
  [ 3, 35, 11, 43,  1, 33,  9, 41],
  [51, 19, 59, 27, 49, 17, 57, 25],
  [15, 47,  7, 39, 13, 45,  5, 37],
  [63, 31, 55, 23, 61, 29, 53, 21],
];

// 16x16 Bayer (generated from 8x8)
const BAYER16: number[][] = (() => {
  const m: number[][] = Array.from({ length: 16 }, () => new Array(16).fill(0));
  for (let y = 0; y < 16; y++) {
    for (let x = 0; x < 16; x++) {
      const b = BAYER8[y % 8][x % 8];
      const q = (Math.floor(y / 8) * 2 + Math.floor(x / 8));
      m[y][x] = b * 4 + q;
    }
  }
  return m;
})();

// Simple 4x4 blue-noise approximation
const BLUE_NOISE_4 = [
  [0.06, 0.69, 0.19, 0.81],
  [0.44, 0.31, 0.56, 0.44],
  [0.75, 0.13, 0.88, 0.25],
  [0.38, 0.63, 0.50, 0.00],
];

// ── Main dithering function ───────────────────────────────────────────────────

export function applyDither(
  srcCanvas: HTMLCanvasElement,
  opts: ProcessOptions
): HTMLCanvasElement {
  const { pixelSize, algorithm, palette: hexPalette, ditherStrength, aspectRatio } = opts;

  const pal = hexPalette.map(hexToRgb);

  // Pixel aspect
  const pixW = aspectRatio === '2:1' ? pixelSize * 2 : pixelSize;
  const pixH = aspectRatio === '1:2' ? pixelSize * 2 : pixelSize;

  // Downscale dimensions
  const srcW = srcCanvas.width;
  const srcH = srcCanvas.height;
  const dW = Math.max(1, Math.round(srcW / pixW));
  const dH = Math.max(1, Math.round(srcH / pixH));

  // Draw source to small canvas
  const small = document.createElement('canvas');
  small.width = dW;
  small.height = dH;
  const sCtx = small.getContext('2d', { willReadFrequently: true })!;
  sCtx.drawImage(srcCanvas, 0, 0, dW, dH);

  let imgData = sCtx.getImageData(0, 0, dW, dH);
  let pix = new Float32Array(imgData.data.length);
  // Copy to float array for processing
  for (let i = 0; i < imgData.data.length; i++) pix[i] = imgData.data[i];

  // Apply adjustments on the small canvas pixels
  const adjData = applyAdjustments(
    imgData.data,
    opts.brightness,
    opts.contrast,
    opts.saturation,
    opts.localContrast,
    dW, dH
  );
  for (let i = 0; i < pix.length; i++) pix[i] = adjData[i];

  // ── Run dithering ────────────────────────────────────────────────
  const str = ditherStrength;

  if (algorithm === 'none') {
    for (let i = 0; i < dW * dH; i++) {
      const pi = i * 4;
      const [nr, ng, nb] = nearestColor(pix[pi], pix[pi + 1], pix[pi + 2], pal);
      pix[pi] = nr; pix[pi + 1] = ng; pix[pi + 2] = nb;
    }
  } else if (algorithm === 'floyd_steinberg') {
    for (let y = 0; y < dH; y++) {
      for (let x = 0; x < dW; x++) {
        const pi = (y * dW + x) * 4;
        const or = pix[pi], og = pix[pi + 1], ob = pix[pi + 2];
        const [nr, ng, nb] = nearestColor(or, og, ob, pal);
        pix[pi] = nr; pix[pi + 1] = ng; pix[pi + 2] = nb;
        const er = (or - nr) * str, eg = (og - ng) * str, eb = (ob - nb) * str;
        spreadError(pix, dW, dH, x, y, er, eg, eb, [
          [1, 0, 7/16], [-1, 1, 3/16], [0, 1, 5/16], [1, 1, 1/16]
        ]);
      }
    }
  } else if (algorithm === 'atkinson') {
    for (let y = 0; y < dH; y++) {
      for (let x = 0; x < dW; x++) {
        const pi = (y * dW + x) * 4;
        const or = pix[pi], og = pix[pi + 1], ob = pix[pi + 2];
        const [nr, ng, nb] = nearestColor(or, og, ob, pal);
        pix[pi] = nr; pix[pi + 1] = ng; pix[pi + 2] = nb;
        const er = (or - nr) * str / 8, eg = (og - ng) * str / 8, eb = (ob - nb) * str / 8;
        const dirs = [[1,0],[2,0],[-1,1],[0,1],[1,1],[0,2]];
        for (const [dx, dy] of dirs) {
          const ni = ((y+dy)*dW+(x+dx))*4;
          if (ni >= 0 && ni < pix.length) {
            pix[ni] += er; pix[ni+1] += eg; pix[ni+2] += eb;
          }
        }
      }
    }
  } else if (algorithm === 'jarvis') {
    for (let y = 0; y < dH; y++) {
      for (let x = 0; x < dW; x++) {
        const pi = (y * dW + x) * 4;
        const or = pix[pi], og = pix[pi + 1], ob = pix[pi + 2];
        const [nr, ng, nb] = nearestColor(or, og, ob, pal);
        pix[pi] = nr; pix[pi + 1] = ng; pix[pi + 2] = nb;
        const er = (or - nr) * str, eg = (og - ng) * str, eb = (ob - nb) * str;
        spreadError(pix, dW, dH, x, y, er, eg, eb, [
          [1,0,7/48],[2,0,5/48],
          [-2,1,3/48],[-1,1,5/48],[0,1,7/48],[1,1,5/48],[2,1,3/48],
          [-2,2,1/48],[-1,2,3/48],[0,2,5/48],[1,2,3/48],[2,2,1/48],
        ]);
      }
    }
  } else if (algorithm === 'stucki') {
    for (let y = 0; y < dH; y++) {
      for (let x = 0; x < dW; x++) {
        const pi = (y * dW + x) * 4;
        const or = pix[pi], og = pix[pi + 1], ob = pix[pi + 2];
        const [nr, ng, nb] = nearestColor(or, og, ob, pal);
        pix[pi] = nr; pix[pi + 1] = ng; pix[pi + 2] = nb;
        const er = (or - nr) * str, eg = (og - ng) * str, eb = (ob - nb) * str;
        spreadError(pix, dW, dH, x, y, er, eg, eb, [
          [1,0,8/42],[2,0,4/42],
          [-2,1,2/42],[-1,1,4/42],[0,1,8/42],[1,1,4/42],[2,1,2/42],
          [-2,2,1/42],[-1,2,2/42],[0,2,4/42],[1,2,2/42],[2,2,1/42],
        ]);
      }
    }
  } else if (algorithm === 'sierra') {
    for (let y = 0; y < dH; y++) {
      for (let x = 0; x < dW; x++) {
        const pi = (y * dW + x) * 4;
        const or = pix[pi], og = pix[pi + 1], ob = pix[pi + 2];
        const [nr, ng, nb] = nearestColor(or, og, ob, pal);
        pix[pi] = nr; pix[pi + 1] = ng; pix[pi + 2] = nb;
        const er = (or - nr) * str, eg = (og - ng) * str, eb = (ob - nb) * str;
        spreadError(pix, dW, dH, x, y, er, eg, eb, [
          [1,0,5/32],[2,0,3/32],
          [-2,1,2/32],[-1,1,4/32],[0,1,5/32],[1,1,4/32],[2,1,2/32],
          [-1,2,2/32],[0,2,3/32],[1,2,2/32],
        ]);
      }
    }
  } else if (algorithm === 'sierra_lite') {
    for (let y = 0; y < dH; y++) {
      for (let x = 0; x < dW; x++) {
        const pi = (y * dW + x) * 4;
        const or = pix[pi], og = pix[pi + 1], ob = pix[pi + 2];
        const [nr, ng, nb] = nearestColor(or, og, ob, pal);
        pix[pi] = nr; pix[pi + 1] = ng; pix[pi + 2] = nb;
        const er = (or - nr) * str, eg = (og - ng) * str, eb = (ob - nb) * str;
        spreadError(pix, dW, dH, x, y, er, eg, eb, [
          [1,0,2/4],
          [-1,1,1/4],[0,1,1/4],
        ]);
      }
    }
  } else if (algorithm.startsWith('bayer') || algorithm === 'blue_noise' || algorithm === 'checkerboard' || algorithm === 'pattern2x2') {
    let bayerMatrix: number[][];
    let matSize: number;
    let maxVal: number;

    if (algorithm === 'bayer2') { bayerMatrix = BAYER2; matSize = 2; maxVal = 3; }
    else if (algorithm === 'bayer4') { bayerMatrix = BAYER4; matSize = 4; maxVal = 15; }
    else if (algorithm === 'bayer16') { bayerMatrix = BAYER16; matSize = 16; maxVal = 255; }
    else if (algorithm === 'checkerboard') {
      bayerMatrix = [[0,2],[2,0]]; matSize = 2; maxVal = 3;
    } else if (algorithm === 'pattern2x2') {
      bayerMatrix = [[0,3],[2,1]]; matSize = 2; maxVal = 3;
    } else if (algorithm === 'blue_noise') {
      // Convert float 0-1 matrix to int matrix
      bayerMatrix = BLUE_NOISE_4.map(row => row.map(v => Math.round(v * 15)));
      matSize = 4; maxVal = 15;
    } else { // bayer8
      bayerMatrix = BAYER8; matSize = 8; maxVal = 63;
    }

    for (let y = 0; y < dH; y++) {
      for (let x = 0; x < dW; x++) {
        const pi = (y * dW + x) * 4;
        const threshold = (bayerMatrix[y % matSize][x % matSize] / maxVal - 0.5) * 255 * str;
        const [nr, ng, nb] = nearestColor(
          clamp(pix[pi] + threshold),
          clamp(pix[pi + 1] + threshold),
          clamp(pix[pi + 2] + threshold),
          pal
        );
        pix[pi] = nr; pix[pi + 1] = ng; pix[pi + 2] = nb;
      }
    }
  } else if (algorithm === 'noise') {
    for (let y = 0; y < dH; y++) {
      for (let x = 0; x < dW; x++) {
        const pi = (y * dW + x) * 4;
        const noise = (Math.random() - 0.5) * 255 * str;
        const [nr, ng, nb] = nearestColor(
          clamp(pix[pi] + noise),
          clamp(pix[pi + 1] + noise),
          clamp(pix[pi + 2] + noise),
          pal
        );
        pix[pi] = nr; pix[pi + 1] = ng; pix[pi + 2] = nb;
      }
    }
  }

  // ── Write back to small canvas ────────────────────────────────────
  const outData = new Uint8ClampedArray(pix.length);
  for (let i = 0; i < pix.length; i++) outData[i] = clamp(pix[i]);
  // Keep original alpha
  for (let i = 3; i < pix.length; i += 4) outData[i] = imgData.data[i];
  sCtx.putImageData(new ImageData(outData, dW, dH), 0, 0);

  // ── Scale back up to original size ────────────────────────────────
  const out = document.createElement('canvas');
  out.width = srcW;
  out.height = srcH;
  const oCtx = out.getContext('2d')!;
  oCtx.imageSmoothingEnabled = false;
  oCtx.drawImage(small, 0, 0, srcW, srcH);

  // ── Apply glitch effects ──────────────────────────────────────────
  applyGlitch(out, opts.glitch);

  return out;
}

function spreadError(
  pix: Float32Array,
  w: number,
  h: number,
  x: number,
  y: number,
  er: number, eg: number, eb: number,
  offsets: [number, number, number][]
) {
  for (const [dx, dy, frac] of offsets) {
    const nx = x + dx, ny = y + dy;
    if (nx < 0 || nx >= w || ny < 0 || ny >= h) continue;
    const ni = (ny * w + nx) * 4;
    pix[ni]     += er * frac;
    pix[ni + 1] += eg * frac;
    pix[ni + 2] += eb * frac;
  }
}

// ── Glitch effects ────────────────────────────────────────────────────────────

function applyGlitch(canvas: HTMLCanvasElement, g: GlitchOptions) {
  if (!g.rgbShift && !g.scanlines && !g.pixelScatter && !g.interlace && !g.vhsBlur) return;

  const w = canvas.width, h = canvas.height;
  const ctx = canvas.getContext('2d')!;

  if (g.vhsBlur > 0) {
    // Horizontal smear
    const id = ctx.getImageData(0, 0, w, h);
    const d = id.data;
    const blurPx = Math.round(g.vhsBlur * 3);
    for (let y = 0; y < h; y++) {
      for (let x = blurPx; x < w; x++) {
        const i = (y * w + x) * 4;
        const pi = (y * w + x - blurPx) * 4;
        d[i]     = (d[i]     + d[pi])     >> 1;
        d[i + 1] = (d[i + 1] + d[pi + 1]) >> 1;
        d[i + 2] = (d[i + 2] + d[pi + 2]) >> 1;
      }
    }
    ctx.putImageData(id, 0, 0);
  }

  if (g.rgbShift > 0) {
    const shift = g.rgbShift;
    const id = ctx.getImageData(0, 0, w, h);
    const src = new Uint8ClampedArray(id.data);
    const d = id.data;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4;
        // Red channel shifted left
        const ri = (y * w + Math.max(0, x - shift)) * 4;
        // Blue channel shifted right
        const bi = (y * w + Math.min(w - 1, x + shift)) * 4;
        d[i]     = src[ri];
        d[i + 2] = src[bi + 2];
      }
    }
    ctx.putImageData(id, 0, 0);
  }

  if (g.pixelScatter > 0) {
    const id = ctx.getImageData(0, 0, w, h);
    const d = id.data;
    const src = new Uint8ClampedArray(d);
    const scatterRadius = g.pixelScatter * 3;
    for (let i = 0; i < d.length; i += 4) {
      if (Math.random() < 0.05) {
        const px = (i / 4) % w;
        const py = Math.floor(i / 4 / w);
        const nx = Math.round(px + (Math.random() - 0.5) * scatterRadius * 2);
        const ny = Math.round(py + (Math.random() - 0.5) * scatterRadius * 2);
        if (nx >= 0 && nx < w && ny >= 0 && ny < h) {
          const ni = (ny * w + nx) * 4;
          d[ni] = src[i]; d[ni + 1] = src[i + 1]; d[ni + 2] = src[i + 2];
        }
      }
    }
    ctx.putImageData(id, 0, 0);
  }

  if (g.scanlines) {
    ctx.save();
    for (let y = 0; y < h; y += 2) {
      ctx.fillStyle = 'rgba(0,0,0,0.25)';
      ctx.fillRect(0, y, w, 1);
    }
    ctx.restore();
  }

  if (g.interlace) {
    ctx.save();
    for (let y = 1; y < h; y += 4) {
      ctx.fillStyle = 'rgba(0,0,0,0.15)';
      ctx.fillRect(0, y, w, 1);
    }
    ctx.restore();
  }
}
