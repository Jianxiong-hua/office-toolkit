/**
 * Malvar-He-Cutler 去马赛克（ICASSP 2004, "High-Quality Linear Interpolation for
 * Demosaicing of Bayer-Patterned Color Images"）。
 *
 * 三个核都作用在同一张 CFA mosaic 上：核中心权重取「同位置另一通道」的值作为强预测，
 * 再减去远距离同色样点做校正。因此不需要中间平面，逐像素算出 R/G/B 后直接映射 8bit。
 *
 * 系数统一 ×2 转整数（原始核含 0.5 / 1.5），分母 16，避免浮点。
 */

export type BayerPattern = "RGGB" | "BGGR" | "GRBG" | "GBRG";

export const BAYER_PATTERNS: BayerPattern[] = ["RGGB", "BGGR", "GRBG", "GBRG"];

/** G at R / B */
const K_G_AT_RB: readonly number[] = [
  0, 0, -2, 0, 0,
  0, 0, 4, 0, 0,
  -2, 4, 8, 4, -2,
  0, 0, 4, 0, 0,
  0, 0, -2, 0, 0,
];

/** X at G，X 与本像素同行（X 在左右两侧） */
const K_AT_G_HORIZ: readonly number[] = [
  0, 0, 1, 0, 0,
  0, -2, 0, -2, 0,
  -2, 8, 10, 8, -2,
  0, -2, 0, -2, 0,
  0, 0, 1, 0, 0,
];

/** X at G，X 与本像素同列（X 在上下两侧） */
const K_AT_G_VERT: readonly number[] = [
  0, 0, -2, 0, 0,
  0, -2, 8, -2, 0,
  1, 0, 10, 0, 1,
  0, -2, 8, -2, 0,
  0, 0, -2, 0, 0,
];

/** X at 另一色（对角采样） */
const K_AT_DIAG: readonly number[] = [
  0, 0, -3, 0, 0,
  0, 4, 0, 4, 0,
  -3, 0, 12, 0, -3,
  0, 4, 0, 4, 0,
  0, 0, -3, 0, 0,
];

interface Taps {
  dx: Int32Array;
  dy: Int32Array;
  coef: Int32Array;
}

function buildTaps(kernel: readonly number[]): Taps {
  const dx: number[] = [];
  const dy: number[] = [];
  const coef: number[] = [];
  for (let ky = 0; ky < 5; ky += 1) {
    for (let kx = 0; kx < 5; kx += 1) {
      const c = kernel[ky * 5 + kx];
      if (c === 0) continue;
      dx.push(kx - 2);
      dy.push(ky - 2);
      coef.push(c);
    }
  }
  return { dx: Int32Array.from(dx), dy: Int32Array.from(dy), coef: Int32Array.from(coef) };
}

const TAPS_G = buildTaps(K_G_AT_RB);
const TAPS_HORIZ = buildTaps(K_AT_G_HORIZ);
const TAPS_VERT = buildTaps(K_AT_G_VERT);
const TAPS_DIAG = buildTaps(K_AT_DIAG);

/** 镜像反射：越界索引折回，不补零（补零会在边框留一圈黑边 + 伪彩） */
function mirror(i: number, n: number): number {
  if (i < 0) return -i - 1;
  if (i >= n) return 2 * n - i - 1;
  return i;
}

function convolve(
  taps: Taps,
  mosaic: Uint16Array,
  width: number,
  colIdx: Int32Array[],
  rowIdx: Int32Array[],
  y: number,
  x: number
): number {
  const { dx, dy, coef } = taps;
  let sum = 0;
  for (let i = 0; i < coef.length; i += 1) {
    const row = rowIdx[dy[i] + 2][y];
    const col = colIdx[dx[i] + 2][x];
    sum += coef[i] * mosaic[row * width + col];
  }
  return sum;
}

/**
 * DN 域去马赛克 + 映射到 8bit RGBA。
 * lut 长度必须等于 2^depth；越界 DN（MH-C 会插出负值与超量程值）在这里 clamp。
 */
export function demosaicMhcToRgba(
  mosaic: Uint16Array,
  width: number,
  height: number,
  pattern: BayerPattern,
  lut: Uint8Array
): Uint8ClampedArray {
  const out = new Uint8ClampedArray(width * height * 4);
  const maxDn = lut.length - 1;

  // 五个偏移量的镜像索引表，逐像素查表代替每次计算
  const colIdx: Int32Array[] = [];
  const rowIdx: Int32Array[] = [];
  for (let d = -2; d <= 2; d += 1) {
    const cols = new Int32Array(width);
    for (let x = 0; x < width; x += 1) cols[x] = mirror(x + d, width);
    colIdx.push(cols);
    const rows = new Int32Array(height);
    for (let y = 0; y < height; y += 1) rows[y] = mirror(y + d, height);
    rowIdx.push(rows);
  }

  const rRowParity = pattern.indexOf("R") >> 1;

  const toByte = (sum: number): number => {
    const dn = Math.round(sum / 16);
    return lut[dn < 0 ? 0 : dn > maxDn ? maxDn : dn];
  };

  // 按 4 个 CFA 相位分别遍历，循环内是固定核，免去逐像素判断颜色
  for (let py = 0; py < 2; py += 1) {
    for (let px = 0; px < 2; px += 1) {
      const color = pattern[(py << 1) | px];

      let tapsR: Taps | null;
      let tapsG: Taps | null;
      let tapsB: Taps | null;
      if (color === "R") {
        tapsR = null;
        tapsG = TAPS_G;
        tapsB = TAPS_DIAG;
      } else if (color === "B") {
        tapsR = TAPS_DIAG;
        tapsG = TAPS_G;
        tapsB = null;
      } else {
        tapsG = null;
        // G 位置：先判断 R 在同行还是同列（这是 MH-C 最容易写错的一步）
        const rHorizontal = rRowParity === py;
        tapsR = rHorizontal ? TAPS_HORIZ : TAPS_VERT;
        tapsB = rHorizontal ? TAPS_VERT : TAPS_HORIZ;
      }

      for (let y = py; y < height; y += 2) {
        for (let x = px; x < width; x += 2) {
          const base = y * width + x;
          const sr = tapsR
            ? convolve(tapsR, mosaic, width, colIdx, rowIdx, y, x)
            : mosaic[base] * 16;
          const sg = tapsG
            ? convolve(tapsG, mosaic, width, colIdx, rowIdx, y, x)
            : mosaic[base] * 16;
          const sb = tapsB
            ? convolve(tapsB, mosaic, width, colIdx, rowIdx, y, x)
            : mosaic[base] * 16;

          const p = base * 4;
          out[p] = toByte(sr);
          out[p + 1] = toByte(sg);
          out[p + 2] = toByte(sb);
          out[p + 3] = 255;
        }
      }
    }
  }

  return out;
}
