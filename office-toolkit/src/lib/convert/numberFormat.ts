/**
 * 数值格式转换纯函数：文本 → 位模式 → 各进制 / IEEE754 分解 / 字节串。
 *
 * 位模式统一用 bigint 表示（浮点也是），进制换算、位翻转、字节序三种操作
 * 因此落在同一套逻辑上。64 位整型必须用 BigInt——Number 超过 2^53 会静默失真。
 * 浮点取值走 DataView，不经过 BigInt 运算。
 */

export type NumType =
  | "u8"
  | "u16"
  | "u32"
  | "u64"
  | "s8"
  | "s16"
  | "s32"
  | "s64"
  | "f32"
  | "f64";

export type FloatType = "f32" | "f64";

/** 进制 */
export type Radix = 2 | 8 | 10 | 16;

/** 进制选择：auto 表示按前缀与字符自动判断 */
export type RadixMode = Radix | "auto";

export type Endianness = "little" | "big";

export const UNSIGNED_TYPES: NumType[] = ["u8", "u16", "u32", "u64"];
export const SIGNED_TYPES: NumType[] = ["s8", "s16", "s32", "s64"];
export const FLOAT_TYPES: FloatType[] = ["f32", "f64"];
export const ALL_TYPES: NumType[] = [
  ...UNSIGNED_TYPES,
  ...SIGNED_TYPES,
  ...FLOAT_TYPES,
];

export const RADIX_OPTIONS: { value: RadixMode; label: string }[] = [
  { value: "auto", label: "自动识别" },
  { value: 16, label: "十六进制" },
  { value: 10, label: "十进制" },
  { value: 8, label: "八进制" },
  { value: 2, label: "二进制" },
];

const RADIX_NAME: Record<Radix, string> = {
  2: "二进制",
  8: "八进制",
  10: "十进制",
  16: "十六进制",
};

const RADIX_ALLOWED: Record<Radix, string> = {
  2: "0-1",
  8: "0-7",
  10: "0-9",
  16: "0-9 A-F",
};

export function radixName(radix: Radix): string {
  return RADIX_NAME[radix];
}

/** 位宽 */
export function typeBits(type: NumType): number {
  if (type === "f64") return 64;
  if (type === "f32") return 32;
  return Number(type.slice(1));
}

export function isFloatType(type: NumType): type is FloatType {
  return type === "f32" || type === "f64";
}

export function isSignedType(type: NumType): boolean {
  return type.startsWith("s");
}

/** 某类型的全 1 掩码 */
function maskOf(type: NumType): bigint {
  return (1n << BigInt(typeBits(type))) - 1n;
}

// ---------------------------------------------------------------------------
// 浮点位模式 <-> 数值
// ---------------------------------------------------------------------------

export function floatToBits(value: number, type: FloatType): bigint {
  const size = type === "f32" ? 4 : 8;
  const view = new DataView(new ArrayBuffer(size));
  if (type === "f32") view.setFloat32(0, value, false);
  else view.setFloat64(0, value, false);
  let bits = 0n;
  for (let i = 0; i < size; i += 1) {
    bits = (bits << 8n) | BigInt(view.getUint8(i));
  }
  return bits;
}

export function bitsToFloat(bits: bigint, type: FloatType): number {
  const size = type === "f32" ? 4 : 8;
  const view = new DataView(new ArrayBuffer(size));
  for (let i = 0; i < size; i += 1) {
    const shift = BigInt((size - 1 - i) * 8);
    view.setUint8(i, Number((bits >> shift) & 0xffn));
  }
  return type === "f32" ? view.getFloat32(0, false) : view.getFloat64(0, false);
}

export type FloatKind =
  | "zero"
  | "denormal"
  | "normal"
  | "infinity"
  | "nan";

export interface FloatBreakdown {
  type: FloatType;
  sign: 0 | 1;
  exponentField: bigint;
  mantissaField: bigint;
  exponentBits: number;
  mantissaBits: number;
  bias: number;
  /** 实际指数 = 指数位 - bias；denormal / inf / nan 无意义时为 null */
  actualExponent: number | null;
  kind: FloatKind;
  value: number;
}

export function decodeFloat(bits: bigint, type: FloatType): FloatBreakdown {
  const signBits = type === "f32" ? 8 : 11;
  const mantissaBits = type === "f32" ? 23 : 52;
  const bias = type === "f32" ? 127 : 1023;

  const sign = Number((bits >> BigInt(signBits + mantissaBits)) & 1n) as 0 | 1;
  const exponentField = (bits >> BigInt(mantissaBits)) & ((1n << BigInt(signBits)) - 1n);
  const mantissaField = bits & ((1n << BigInt(mantissaBits)) - 1n);

  const expMax = (1n << BigInt(signBits)) - 1n;
  let kind: FloatKind;
  if (exponentField === expMax) {
    kind = mantissaField === 0n ? "infinity" : "nan";
  } else if (exponentField === 0n) {
    kind = mantissaField === 0n ? "zero" : "denormal";
  } else {
    kind = "normal";
  }

  return {
    type,
    sign,
    exponentField,
    mantissaField,
    exponentBits: signBits,
    mantissaBits,
    bias,
    actualExponent: kind === "normal" ? Number(exponentField) - bias : null,
    kind,
    value: bitsToFloat(bits, type),
  };
}

// ---------------------------------------------------------------------------
// 格式化
// ---------------------------------------------------------------------------

export interface NumberForms {
  /** 十进制（整型为有/无符号解释结果，浮点为数值） */
  dec: string;
  /** 无前缀大写十六进制，按位宽补零 */
  hex: string;
  /** 无前缀八进制；浮点类型返回 null（位模式的八进制没有实用意义） */
  oct: string | null;
  /** 二进制，每 4 位一组 */
  bin: string;
  /** 大端字节串，如 "3F 80 00 00" */
  bytesBE: string;
  /** 小端字节串 */
  bytesLE: string;
}

export function binString(bits: bigint, width: number): string {
  return bits.toString(2).padStart(width, "0");
}

export function binGroups(bits: bigint, width: number): string {
  return (binString(bits, width).match(/.{1,4}/g) ?? []).join(" ");
}

function hexBytes(bits: bigint, byteLen: number, endianness: Endianness): string {
  const pairs =
    bits.toString(16).toUpperCase().padStart(byteLen * 2, "0").match(/.{2}/g) ?? [];
  return (endianness === "big" ? pairs : [...pairs].reverse()).join(" ");
}

export function formatBits(bits: bigint, type: NumType): NumberForms {
  const width = typeBits(type);
  const byteLen = width / 8;

  let dec: string;
  if (isFloatType(type)) {
    const value = bitsToFloat(bits, type);
    if (Number.isNaN(value)) dec = "NaN";
    else if (!Number.isFinite(value)) dec = value > 0 ? "+Infinity" : "-Infinity";
    else dec = String(value);
  } else {
    const value =
      isSignedType(type) && bits >= 1n << BigInt(width - 1)
        ? bits - (1n << BigInt(width))
        : bits;
    dec = value.toString();
  }

  return {
    dec,
    hex: bits.toString(16).toUpperCase().padStart(width / 4, "0"),
    oct: isFloatType(type) ? null : bits.toString(8).padStart(Math.ceil(width / 3), "0"),
    bin: binGroups(bits, width),
    bytesBE: hexBytes(bits, byteLen, "big"),
    bytesLE: hexBytes(bits, byteLen, "little"),
  };
}

// ---------------------------------------------------------------------------
// 位操作
// ---------------------------------------------------------------------------

/** index 0 为最低位 */
export function getBit(bits: bigint, index: number): 0 | 1 {
  return Number((bits >> BigInt(index)) & 1n) as 0 | 1;
}

export function toggleBit(bits: bigint, index: number, type: NumType): bigint {
  return (bits ^ (1n << BigInt(index))) & maskOf(type);
}

/**
 * 整条位模式移 1 位：left 向高位（MSB）移，右端补 0，移出位丢弃；right 反之。
 * 浮点类型同样按原始位模式移位——给的是位视图工具，不解释语义。
 */
export function shiftBits(bits: bigint, direction: "left" | "right", type: NumType): bigint {
  return direction === "left" ? (bits << 1n) & maskOf(type) : (bits >> 1n) & maskOf(type);
}

// ---------------------------------------------------------------------------
// 解析
// ---------------------------------------------------------------------------

export interface ParseOptions {
  type: NumType;
  radixMode: RadixMode;
  endianness: Endianness;
}

export type ParseResult =
  | { ok: true; bits: bigint; radix: Radix }
  | { ok: false; error: string };

const UINT_MAX: [NumType, bigint][] = [
  ["u8", (1n << 8n) - 1n],
  ["u16", (1n << 16n) - 1n],
  ["u32", (1n << 32n) - 1n],
  ["u64", (1n << 64n) - 1n],
];

const SINT_LIMIT: [NumType, bigint][] = [
  ["s8", 1n << 7n],
  ["s16", 1n << 15n],
  ["s32", 1n << 31n],
  ["s64", 1n << 63n],
];

/** 只建议比当前类型更宽的类型，避免出现「已超出 s64，建议 s64」 */
export function suggestUnsignedType(magnitude: bigint, current: NumType): NumType | null {
  for (const [name, max] of UINT_MAX) {
    if (typeBits(name) <= typeBits(current)) continue;
    if (magnitude <= max) return name;
  }
  return null;
}

export function suggestSignedType(magnitude: bigint, current: NumType): NumType | null {
  for (const [name, limit] of SINT_LIMIT) {
    if (typeBits(name) <= typeBits(current)) continue;
    if (magnitude <= limit) return name;
  }
  return null;
}

function detectRadix(body: string, explicit: RadixMode): Radix {
  if (explicit !== "auto") return explicit;
  const lower = body.toLowerCase();
  if (lower.startsWith("0x")) return 16;
  if (lower.startsWith("0b")) return 2;
  if (lower.startsWith("0o")) return 8;
  // 空格分隔的字节串只可能是十六进制：十进制不会带内部空格
  if (/\s/.test(body) && /^[0-9a-f\s]+$/i.test(body)) return 16;
  // 纯十进制（含小数与指数）优先判 10，避免 "1e40" 里的 e 被当成十六进制数字
  if (/^\d+(\.\d+)?([eE][-+]?\d+)?$/.test(body)) return 10;
  if (/^[0-9a-f]+$/i.test(body)) return 16;
  return 10;
}

function stripPrefix(body: string): string {
  return body.replace(/^0[xXbBoO]/, "");
}

/**
 * 严格字节串格式：每段正好 2 个十六进制数字，段间至少一个空格，至少两段。
 * 收紧到 2 位是为了不把 "1010 1010" 这类分组二进制误判成字节串。
 */
function isByteString(body: string): boolean {
  return /^[0-9a-f]{2}(\s+[0-9a-f]{2})+$/i.test(body.trim());
}

/**
 * 输入是否会被当作空格分隔的十六进制字节串。
 * 只有这种输入才受字节序影响，界面上据此使能「大端 / 小端」。
 */
export function isByteStringInput(text: string, radixMode: RadixMode): boolean {
  const unsigned = text.trim().replace(/^[-+]/, "");
  if (!unsigned) return false;
  return detectRadix(unsigned, radixMode) === 16 && isByteString(stripPrefix(unsigned));
}

/** 位模式按字节串组装（仅当输入是空格分隔的十六进制字节串时使用） */
function bytesToBits(bytes: number[], endianness: Endianness): bigint {
  const seq = endianness === "big" ? bytes : [...bytes].reverse();
  let value = 0n;
  for (const byte of seq) value = (value << 8n) | BigInt(byte);
  return value;
}

export function parseInput(raw: string, options: ParseOptions): ParseResult {
  const text = raw.trim();
  if (!text) return { ok: false, error: "请输入一个值" };

  const negative = text.startsWith("-");
  const unsignedText = text.replace(/^[-+]/, "");
  const radix = detectRadix(unsignedText, options.radixMode);
  const width = typeBits(options.type);
  const float = isFloatType(options.type);

  // 空格分隔的十六进制字节串：按字节序组装（从内存 dump 直接粘贴的场景）
  const withoutPrefix = stripPrefix(unsignedText);
  if (radix === 16 && isByteString(withoutPrefix)) {
    if (negative) return { ok: false, error: "字节串不能带负号" };
    const digits = withoutPrefix.replace(/\s/g, "");
    const bytes = (digits.match(/.{2}/g) ?? []).map((pair) => parseInt(pair, 16));
    const byteLen = width / 8;
    if (bytes.length > byteLen) {
      return {
        ok: false,
        error: `${bytes.length} 个字节超出 ${options.type} 的 ${byteLen} 字节宽度`,
      };
    }
    return { ok: true, bits: bytesToBits(bytes, options.endianness), radix };
  }

  const body = stripPrefix(unsignedText).replace(/[\s_]/g, "");
  if (!body) return { ok: false, error: "缺少数字" };

  // 浮点 + 十进制：按数值理解（允许小数与指数写法），因此放在整数校验之前
  if (float && radix === 10) {
    if (!/^\d+(\.\d+)?([eE][-+]?\d+)?$/.test(body)) {
      return { ok: false, error: `"${text}" 无法解析为十进制浮点数` };
    }
    const floatType: FloatType = options.type === "f64" ? "f64" : "f32";
    const number = Number(`${negative ? "-" : ""}${body}`);
    const stored = floatType === "f32" ? Math.fround(number) : number;
    return { ok: true, bits: floatToBits(stored, floatType), radix };
  }

  for (const ch of body) {
    const code = ch.toUpperCase().charCodeAt(0);
    const value =
      code >= 48 && code <= 57 ? code - 48 : code >= 65 && code <= 90 ? code - 55 : -1;
    if (value < 0 || value >= radix) {
      return {
        ok: false,
        error: `含非法字符 "${ch}"，${RADIX_NAME[radix]}只允许 ${RADIX_ALLOWED[radix]}`,
      };
    }
  }

  let magnitude = 0n;
  const base = BigInt(radix);
  for (const ch of body) {
    const code = ch.toUpperCase().charCodeAt(0);
    const digit = BigInt(code >= 48 && code <= 57 ? code - 48 : code - 55);
    magnitude = magnitude * base + digit;
  }

  // 非十进制输入按位模式解释：0xFF 之于 s8 就是 -1，0x1FF 之于 u8 仍属溢出
  if (radix !== 10) {
    if (negative) {
      return {
        ok: false,
        error: `${RADIX_NAME[radix]}输入按位模式解释，不能带负号`,
      };
    }
    if (magnitude > maskOf(options.type)) {
      const required = magnitude === 0n ? 1 : magnitude.toString(2).length;
      const suggestion = ALL_TYPES.filter((t) => !isFloatType(t)).find(
        (t) => typeBits(t) >= required
      );
      return {
        ok: false,
        error: `${text} 超出 ${options.type} 的 ${width} 位范围${
          suggestion ? `，可用 ${suggestion}` : "，已超出 64 位上限"
        }`,
      };
    }
    return { ok: true, bits: magnitude, radix };
  }

  if (isSignedType(options.type)) {
    if (negative) {
      const limit = 1n << BigInt(width - 1);
      if (magnitude > limit) {
        const suggestion = suggestSignedType(magnitude, options.type);
        return {
          ok: false,
          error: `-${magnitude} 超出 ${options.type} 范围（${-(limit)} ~ ${limit - 1n}）${
            suggestion ? `，可用 ${suggestion}` : "，已超出 64 位上限"
          }`,
        };
      }
      return { ok: true, bits: (1n << BigInt(width)) - magnitude, radix };
    }
    const max = (1n << BigInt(width - 1)) - 1n;
    if (magnitude > max) {
      const suggestion = suggestSignedType(magnitude, options.type);
      return {
        ok: false,
        error: `${magnitude} 超出 ${options.type} 范围（最大 ${max}）${
          suggestion ? `，可用 ${suggestion}` : "，已超出 64 位上限"
        }`,
      };
    }
    return { ok: true, bits: magnitude, radix };
  }

  if (negative) {
    return {
      ok: false,
      error: `${options.type} 不接受负数，可切换 s${width}`,
    };
  }
  const max = maskOf(options.type);
  if (magnitude > max) {
    const suggestion = suggestUnsignedType(magnitude, options.type);
    return {
      ok: false,
      error: `0x${magnitude.toString(16).toUpperCase()} 超出 ${options.type} 范围（最大 0x${max
        .toString(16)
        .toUpperCase()}）${suggestion ? `，可用 ${suggestion}` : "，已超出 64 位上限"}`,
    };
  }
  return { ok: true, bits: magnitude, radix };
}
