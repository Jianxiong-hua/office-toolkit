"use client";

import { binString, decodeFloat, type FloatKind, type FloatType } from "@/lib/convert/numberFormat";

const KIND_LABEL: Record<FloatKind, string> = {
  normal: "规格化数（normal）",
  denormal: "非规格化数（denormal）",
  zero: "零",
  infinity: "无穷大（infinity）",
  nan: "非数（NaN）",
};

const KIND_STYLE: Record<FloatKind, string> = {
  normal: "bg-gray-100 text-gray-600",
  denormal: "bg-amber-100 text-amber-700",
  zero: "bg-gray-100 text-gray-600",
  infinity: "bg-red-100 text-red-700",
  nan: "bg-purple-100 text-purple-700",
};

export function FloatBreakdown({
  bits,
  type,
  decimalInput,
}: {
  bits: bigint;
  type: FloatType;
  /** 十进制输入的原始数值，用于提示精度损失 */
  decimalInput?: number;
}) {
  const info = decodeFloat(bits, type);
  const storedText = Number.isNaN(info.value)
    ? "NaN"
    : Number.isFinite(info.value)
      ? String(info.value)
      : info.value > 0
        ? "+Infinity"
        : "-Infinity";

  const precisionLost =
    decimalInput !== undefined &&
    Number.isFinite(decimalInput) &&
    decimalInput !== info.value;

  return (
    <div className="space-y-4">
      <div className="rounded-xl bg-gray-50 px-3 py-2 font-mono text-xs leading-relaxed break-all">
        <span className="text-amber-600">{binString(BigInt(info.sign), 1)}</span>
        <span className="text-gray-300"> </span>
        <span className="text-violet-600">
          {binString(info.exponentField, info.exponentBits)}
        </span>
        <span className="text-gray-300"> </span>
        <span className="text-emerald-600">{binString(info.mantissaField, info.mantissaBits)}</span>
      </div>

      <div className="flex flex-wrap gap-3 text-xs text-gray-500">
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-sm bg-amber-500" />符号 1 位
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-sm bg-violet-500" />指数 {info.exponentBits} 位
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-sm bg-emerald-500" />尾数 {info.mantissaBits} 位
        </span>
      </div>

      <div className="grid grid-cols-[4.5rem_1fr] gap-x-3 gap-y-2 text-sm">
        <span className="text-gray-500">符号</span>
        <span className="font-mono text-gray-900">
          {info.sign}（{info.sign === 0 ? "正" : "负"}）
        </span>

        <span className="text-gray-500">指数位</span>
        <span className="font-mono break-all text-gray-900">
          {info.exponentField.toString()} / 0b
          {binString(info.exponentField, info.exponentBits)}
        </span>

        <span className="text-gray-500">偏移量</span>
        <span className="font-mono text-gray-900">{info.bias}</span>

        <span className="text-gray-500">实际指数</span>
        <span className="font-mono text-gray-900">
          {info.actualExponent === null ? "—" : info.actualExponent}
        </span>

        <span className="text-gray-500">尾数位</span>
        <span className="font-mono break-all text-gray-900">
          {info.mantissaField.toString()}
        </span>

        <span className="text-gray-500">存储值</span>
        <span className="font-mono break-all text-gray-900">{storedText}</span>

        <span className="text-gray-500">类型</span>
        <span>
          <span
            className={`inline-flex rounded-md px-2 py-0.5 text-xs font-medium ${KIND_STYLE[info.kind]}`}
          >
            {KIND_LABEL[info.kind]}
          </span>
        </span>
      </div>

      {precisionLost && (
        <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs leading-relaxed text-amber-700">
          十进制输入 {decimalInput} 无法被 {type === "f32" ? "float32" : "float64"} 精确表示，
          实际存储值 = <span className="font-mono">{storedText}</span>
        </p>
      )}
    </div>
  );
}
