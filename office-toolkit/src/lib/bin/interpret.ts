/** 从指定偏移量起，按大端/小端解释数值（纯函数） */

interface NumericType {
  label: string;
  size: number;
}

/** 展示顺序即表格行顺序 */
const NUMERIC_TYPES: NumericType[] = [
  { label: "uint8", size: 1 },
  { label: "int8", size: 1 },
  { label: "uint16", size: 2 },
  { label: "int16", size: 2 },
  { label: "uint32", size: 4 },
  { label: "int32", size: 4 },
  { label: "float32", size: 4 },
  { label: "float64", size: 8 },
];

export interface InterpretItem {
  label: string;
  size: number;
  /** 大端（Big-Endian）解释结果，不足 size 字节时为 "—" */
  big: string;
  /** 小端（Little-Endian）解释结果，不足 size 字节时为 "—" */
  little: string;
}

export interface InterpretResult {
  offset: number;
  items: InterpretItem[];
}

function formatFloat(value: number): string {
  if (Number.isNaN(value)) return "NaN";
  if (!Number.isFinite(value)) return value > 0 ? "Infinity" : "-Infinity";
  // 浮点数转字符串时二进制表示常带长尾（如 0.1 → 0.10000000149011612），
  // 收敛到 7 位有效数字，够读且不丢量级
  return Number.isInteger(value) ? String(value) : String(Number(value.toPrecision(7)));
}

function readValue(
  view: DataView,
  offset: number,
  label: string,
  littleEndian: boolean
): string {
  switch (label) {
    case "uint8":
      return String(view.getUint8(offset));
    case "int8":
      return String(view.getInt8(offset));
    case "uint16":
      return String(view.getUint16(offset, littleEndian));
    case "int16":
      return String(view.getInt16(offset, littleEndian));
    case "uint32":
      return String(view.getUint32(offset, littleEndian));
    case "int32":
      return String(view.getInt32(offset, littleEndian));
    case "float32":
      return formatFloat(view.getFloat32(offset, littleEndian));
    case "float64":
      return formatFloat(view.getFloat64(offset, littleEndian));
    default:
      return "—";
  }
}

/**
 * 从 offset 处开始解释数值。
 * bytes 可能是 subarray，因此 DataView 必须带上 byteOffset/byteLength 限定范围。
 */
export function interpretAt(bytes: Uint8Array, offset: number): InterpretResult {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return {
    offset,
    items: NUMERIC_TYPES.map(({ label, size }) => {
      // 剩余字节不足时不做读取，避免 DataView 越界抛错
      if (offset + size > bytes.length) {
        return { label, size, big: "—", little: "—" };
      }
      return {
        label,
        size,
        big: readValue(view, offset, label, false),
        little: readValue(view, offset, label, true),
      };
    }),
  };
}
