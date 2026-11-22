"use client";

import { getBit, isFloatType, typeBits, type NumType } from "@/lib/convert/numberFormat";

type Field = "sign" | "exponent" | "mantissa" | "plain";

const FIELD_STYLES: Record<Field, { on: string; off: string }> = {
  sign: { on: "bg-amber-500 text-white", off: "bg-amber-50 text-amber-600" },
  exponent: { on: "bg-violet-500 text-white", off: "bg-violet-50 text-violet-600" },
  mantissa: { on: "bg-emerald-500 text-white", off: "bg-emerald-50 text-emerald-600" },
  plain: { on: "bg-brand-600 text-white", off: "bg-gray-100 text-gray-400" },
};

const FIELD_LABEL: Record<Field, string> = {
  sign: "符号位",
  exponent: "指数位",
  mantissa: "尾数位",
  plain: "位",
};

function fieldOf(index: number, type: NumType): Field {
  if (!isFloatType(type)) return "plain";
  const width = typeBits(type);
  const exponentBits = type === "f32" ? 8 : 11;
  if (index === width - 1) return "sign";
  if (index >= width - 1 - exponentBits) return "exponent";
  return "mantissa";
}

export function BitGrid({
  bits,
  type,
  onToggle,
}: {
  bits: bigint;
  type: NumType;
  onToggle: (index: number) => void;
}) {
  const width = typeBits(type);
  // MSB 在最左，8 位一组；index 0 是最低位
  const indices = Array.from({ length: width }, (_, i) => width - 1 - i);
  const groups: number[][] = [];
  for (let i = 0; i < indices.length; i += 8) {
    groups.push(indices.slice(i, i + 8));
  }

  return (
    <div className="flex flex-wrap gap-x-4 gap-y-3">
      {groups.map((group) => (
        <div key={group[group.length - 1]} className="flex gap-1">
          {group.map((index) => {
            const bit = getBit(bits, index);
            const field = fieldOf(index, type);
            const style = FIELD_STYLES[field];
            return (
              <div key={index} className="flex flex-col items-center gap-1">
                <button
                  type="button"
                  onClick={() => onToggle(index)}
                  title={`第 ${index} 位（${FIELD_LABEL[field]} = ${bit}），点击翻转`}
                  className={`h-7 w-6 rounded font-mono text-xs transition-colors ${
                    bit === 1 ? style.on : style.off
                  }`}
                >
                  {bit}
                </button>
                <span className="font-mono text-[10px] text-gray-400">{index}</span>
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}
