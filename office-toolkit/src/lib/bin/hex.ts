/** Hex 视图的行格式化与偏移解析（纯函数，供虚拟滚动按需调用） */

/** 每行字节数可选项 */
export const BYTES_PER_LINE_OPTIONS = [8, 16, 24, 32] as const;
export const DEFAULT_BYTES_PER_LINE = 16;

/**
 * 单行高度（px）。
 * 必须与 HexView.tsx 中行元素的 className 保持一致（`h-6` = 1.5rem = 24px），
 * 否则虚拟滚动的像素换算会错位。
 */
export const ROW_HEIGHT = 24;

/** 总行数 */
export function totalLines(byteLength: number, bytesPerLine: number): number {
  return Math.ceil(byteLength / bytesPerLine);
}

export interface HexCell {
  /** 该字节在文件中的绝对偏移 */
  index: number;
  /** 大写两位十六进制，不足两位补 0 */
  hex: string;
  /** 可打印 ASCII 原样显示，其余为 `.` */
  ascii: string;
}

export interface HexRow {
  /** 8 位大写十六进制偏移量 */
  offset: string;
  cells: HexCell[];
}

const HEX = "0123456789ABCDEF";

/** 单个字节转大写两位十六进制 */
function toHex(byte: number): string {
  return HEX[byte >> 4] + HEX[byte & 0x0f];
}

/**
 * 格式化一行。
 * 只做纯计算、不碰 DOM，因此虚拟滚动只需计算可视区的 ~50 行。
 */
export function formatRow(
  bytes: Uint8Array,
  lineIndex: number,
  bytesPerLine: number
): HexRow {
  const start = lineIndex * bytesPerLine;
  const end = Math.min(start + bytesPerLine, bytes.length);
  const cells: HexCell[] = [];
  for (let i = start; i < end; i++) {
    const v = bytes[i];
    cells.push({
      index: i,
      hex: toHex(v),
      ascii: v >= 0x20 && v <= 0x7e ? String.fromCharCode(v) : ".",
    });
  }
  return {
    offset: start.toString(16).toUpperCase().padStart(8, "0"),
    cells,
  };
}

/**
 * 解析偏移量输入。
 *
 * 统一按**十六进制**解释（与偏移量列的显示方式一致）：
 * - `1F` / `0x1F` / `0X1f` 均表示 31
 * - 纯数字 `20` 表示 32（十六进制 0x20）
 *
 * 越界或非法输入返回 null。
 */
export function parseOffset(input: string, byteLength: number): number | null {
  const s = input.trim();
  if (!/^(0[xX])?[0-9a-fA-F]+$/.test(s)) return null;
  const value = parseInt(s.startsWith("0x") || s.startsWith("0X") ? s.slice(2) : s, 16);
  if (!Number.isFinite(value) || value < 0 || value >= byteLength) return null;
  return value;
}

/** 把偏移量格式化为 8 位大写十六进制 */
export function formatOffset(index: number): string {
  return index.toString(16).toUpperCase().padStart(8, "0");
}
