"use client";

import { useMemo, useState } from "react";
import { ArrowLeft, ArrowRight, Check, Copy } from "lucide-react";
import { ToolLayout } from "@/components/layout/ToolLayout";
import {
  FLOAT_TYPES,
  RADIX_OPTIONS,
  SIGNED_TYPES,
  UNSIGNED_TYPES,
  decodeFloat,
  formatBits,
  isByteStringInput,
  isFloatType,
  isSignedType,
  parseInput,
  radixName,
  shiftBits,
  toggleBit,
  typeBits,
  type Endianness,
  type NumType,
  type Radix,
  type RadixMode,
} from "@/lib/convert/numberFormat";
import { BitGrid } from "./BitGrid";
import { FloatBreakdown } from "./FloatBreakdown";

interface ConvertState {
  text: string;
  bits: bigint;
  /** 解析得到的进制，null 表示空输入 */
  radix: Radix | null;
  error: string | null;
}

function maskOfType(type: NumType): bigint {
  return (1n << BigInt(typeBits(type))) - 1n;
}

function hexOf(bits: bigint, type: NumType): string {
  return `0x${bits.toString(16).toUpperCase().padStart(typeBits(type) / 4, "0")}`;
}

async function copyText(value: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(value);
    return true;
  } catch {
    // 非安全上下文（http）下 clipboard API 不可用，退回临时 textarea
    const textarea = document.createElement("textarea");
    textarea.value = value;
    textarea.style.position = "fixed";
    textarea.style.opacity = "0";
    document.body.appendChild(textarea);
    textarea.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(textarea);
    return ok;
  }
}

function CopyRow({ label, value, hint }: { label: string; value: string; hint?: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    if (!(await copyText(value))) return;
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1200);
  };

  return (
    <div className="flex items-start gap-3 py-2.5">
      <span className="w-16 shrink-0 pt-0.5 text-sm text-gray-500">{label}</span>
      <code className="min-w-0 flex-1 break-all font-mono text-sm text-gray-900">{value}</code>
      {hint && <span className="shrink-0 pt-0.5 text-xs text-gray-400">{hint}</span>}
      <button
        type="button"
        onClick={handleCopy}
        title={`复制${label}`}
        className="shrink-0 rounded-md p-1 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600"
      >
        {copied ? <Check className="h-4 w-4 text-green-600" /> : <Copy className="h-4 w-4" />}
      </button>
    </div>
  );
}

function SectionCard({
  title,
  aside,
  children,
}: {
  title: string;
  aside?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-2xl border border-gray-100 bg-white p-5 shadow-sm sm:p-6">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-base font-semibold text-gray-900">{title}</h2>
        {aside && <div className="flex flex-wrap items-center gap-2 text-xs text-gray-400">{aside}</div>}
      </div>
      {children}
    </section>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-xs font-medium text-gray-500">
        {label}
        {hint && <span className="ml-1.5 font-normal text-gray-400">{hint}</span>}
      </span>
      {children}
    </label>
  );
}

const CONTROL_CLASS =
  "w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 focus:border-brand-400 focus:outline-none";

export default function HexConvertPage() {
  const [type, setType] = useState<NumType>("u32");
  const [radixMode, setRadixMode] = useState<RadixMode>("auto");
  // 默认大端：与人书写字节串的顺序一致（第一个字节就是高位）
  const [endianness, setEndianness] = useState<Endianness>("big");
  const [state, setState] = useState<ConvertState>({
    text: "0x3F800000",
    bits: 0x3f800000n,
    radix: 16,
    error: null,
  });

  const width = typeBits(type);
  const forms = useMemo(() => formatBits(state.bits, type), [state.bits, type]);
  const floatInfo = isFloatType(type) ? decodeFloat(state.bits, type) : null;
  // 只有空格分隔的十六进制字节串才受字节序影响，其余输入下按钮置灰
  const byteStringInput = isByteStringInput(state.text, radixMode);

  const decimalInput = useMemo(() => {
    if (!isFloatType(type) || state.radix !== 10) return undefined;
    const value = Number(state.text.replace(/[\s_]/g, ""));
    return Number.isNaN(value) ? undefined : value;
  }, [state.text, state.radix, type]);

  const handleText = (text: string) => {
    setState((prev) => {
      if (!text.trim()) return { text, bits: prev.bits, radix: null, error: null };
      const result = parseInput(text, { type, radixMode, endianness });
      return result.ok
        ? { text, bits: result.bits, radix: result.radix, error: null }
        : { ...prev, text, error: result.error };
    });
  };

  const handleType = (nextType: NumType) => {
    setType(nextType);
    setState((prev) => {
      const result = prev.text.trim()
        ? parseInput(prev.text, { type: nextType, radixMode, endianness })
        : null;
      if (result?.ok) {
        return { ...prev, bits: result.bits, radix: result.radix, error: null };
      }
      // 新类型装不下原值：按新位宽截断，并把文本框改写成十六进制，保持文本与结果一致
      const masked = prev.bits & maskOfType(nextType);
      return { text: hexOf(masked, nextType), bits: masked, radix: 16, error: null };
    });
  };

  const handleRadixMode = (nextMode: RadixMode) => {
    setRadixMode(nextMode);
    setState((prev) => {
      if (!prev.text.trim()) return prev;
      const result = parseInput(prev.text, { type, radixMode: nextMode, endianness });
      return result.ok
        ? { ...prev, bits: result.bits, radix: result.radix, error: null }
        : { ...prev, error: result.error };
    });
  };

  const handleEndianness = (next: Endianness) => {
    setEndianness(next);
    setState((prev) => {
      if (!prev.text.trim()) return prev;
      const result = parseInput(prev.text, { type, radixMode, endianness: next });
      return result.ok
        ? { ...prev, bits: result.bits, radix: result.radix, error: null }
        : { ...prev, error: result.error };
    });
  };

  const handleToggleBit = (index: number) => {
    setState((prev) => {
      const next = toggleBit(prev.bits, index, type);
      return { text: hexOf(next, type), bits: next, radix: 16, error: null };
    });
  };

  const handleShift = (direction: "left" | "right") => {
    setState((prev) => {
      const next = shiftBits(prev.bits, direction, type);
      return { text: hexOf(next, type), bits: next, radix: 16, error: null };
    });
  };

  return (
    <ToolLayout
      title="进制与浮点转换"
      description="十六进制、十进制、八进制、二进制与 IEEE 754 浮点互转，可逐位翻转查看数值变化，全部在浏览器本地计算。"
    >
      <div className="space-y-5">
        <section className="rounded-2xl border border-gray-100 bg-white p-5 shadow-sm sm:p-6">
          <div className="flex flex-col gap-4">
            <label className="flex flex-col gap-1.5">
              <span className="text-xs font-medium text-gray-500">输入值</span>
              <input
                value={state.text}
                onChange={(event) => handleText(event.target.value)}
                spellCheck={false}
                autoComplete="off"
                placeholder="如 0x3F800000 / 1065353216 / 00 00 80 3F"
                className="w-full rounded-xl border border-gray-200 px-4 py-3 font-mono text-lg text-gray-900 focus:border-brand-400 focus:outline-none"
              />
            </label>

            {state.error && <p className="text-sm text-red-600">{state.error}</p>}

            <div className="grid gap-3 sm:grid-cols-3">
              <Field
                label="进制"
                hint={
                  radixMode === "auto" && state.radix ? `识别为${radixName(state.radix)}` : undefined
                }
              >
                <select
                  value={String(radixMode)}
                  onChange={(event) =>
                    handleRadixMode(
                      event.target.value === "auto"
                        ? "auto"
                        : (Number(event.target.value) as Radix)
                    )
                  }
                  className={CONTROL_CLASS}
                >
                  {RADIX_OPTIONS.map((option) => (
                    <option key={option.value} value={String(option.value)}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </Field>

              <Field label="类型">
                <select
                  value={type}
                  onChange={(event) => handleType(event.target.value as NumType)}
                  className={CONTROL_CLASS}
                >
                  <optgroup label="无符号整数">
                    {UNSIGNED_TYPES.map((item) => (
                      <option key={item} value={item}>
                        {item}
                      </option>
                    ))}
                  </optgroup>
                  <optgroup label="有符号整数">
                    {SIGNED_TYPES.map((item) => (
                      <option key={item} value={item}>
                        {item}
                      </option>
                    ))}
                  </optgroup>
                  <optgroup label="浮点（IEEE 754）">
                    {FLOAT_TYPES.map((item) => (
                      <option key={item} value={item}>
                        {item}
                      </option>
                    ))}
                  </optgroup>
                </select>
              </Field>

              <Field
                label="字节序"
                hint={byteStringInput ? "按字节串组装" : "仅空格分隔的十六进制字节串可用"}
              >
                <div
                  className={`inline-flex w-full rounded-lg border border-gray-200 p-0.5 ${
                    byteStringInput ? "" : "opacity-50"
                  }`}
                >
                  {(["big", "little"] as Endianness[]).map((item) => (
                    <button
                      key={item}
                      type="button"
                      onClick={() => handleEndianness(item)}
                      disabled={!byteStringInput}
                      title={
                        byteStringInput
                          ? "按字节串输入时，用哪种顺序组装成数值"
                          : "当前输入不是空格分隔的十六进制字节串，字节序不参与计算"
                      }
                      className={`flex-1 rounded-md px-3 py-1.5 text-sm transition-colors ${
                        endianness === item
                          ? "bg-brand-600 text-white"
                          : "text-gray-600 hover:bg-gray-50"
                      } ${byteStringInput ? "" : "cursor-not-allowed"}`}
                    >
                      {item === "little" ? "小端" : "大端"}
                    </button>
                  ))}
                </div>
              </Field>
            </div>

            <p className="text-xs leading-relaxed text-gray-400">
              十进制输入按数值解释（可写小数与指数，如 0.1、1e40）；十六进制等非十进制输入按位模式解释。
              十六进制可用空格分隔字节（如 00 00 80 3F），此时才按所选字节序组装，其余输入字节序不参与计算。
            </p>
          </div>
        </section>

        <SectionCard title="各进制表示" aside={`${width} 位`}>
          <div className="divide-y divide-gray-100">
            <CopyRow label="十进制" value={forms.dec} />
            <CopyRow
              label="十六进制"
              value={`0x${forms.hex}`}
              hint={isSignedType(type) ? "补码表示" : isFloatType(type) ? "位模式" : undefined}
            />
            {forms.oct !== null && <CopyRow label="八进制" value={`0o${forms.oct}`} />}
            <CopyRow label="二进制" value={forms.bin} />
          </div>
        </SectionCard>

        <SectionCard
          title="位视图"
          aside={
            <>
              <span>与字节序无关，点击任一位可翻转</span>
              <div className="flex gap-1">
                <button
                  type="button"
                  onClick={() => handleShift("left")}
                  title="整条位模式左移一位（向高位），移出的位丢弃，右端补 0"
                  className="inline-flex items-center gap-1 rounded-md border border-gray-200 px-2 py-1 text-gray-600 transition-colors hover:bg-gray-50"
                >
                  <ArrowLeft className="h-3.5 w-3.5" />
                  左移
                </button>
                <button
                  type="button"
                  onClick={() => handleShift("right")}
                  title="整条位模式右移一位（向低位），移出的位丢弃，左端补 0"
                  className="inline-flex items-center gap-1 rounded-md border border-gray-200 px-2 py-1 text-gray-600 transition-colors hover:bg-gray-50"
                >
                  右移
                  <ArrowRight className="h-3.5 w-3.5" />
                </button>
              </div>
            </>
          }
        >
          <BitGrid bits={state.bits} type={type} onToggle={handleToggleBit} />
        </SectionCard>

        {floatInfo && isFloatType(type) && (
          <SectionCard title="IEEE 754 分解" aside={type === "f32" ? "float32" : "float64"}>
            <FloatBreakdown bits={state.bits} type={type} decimalInput={decimalInput} />
          </SectionCard>
        )}

        <SectionCard title="字节串" aside="按所选字节序解释空格分隔的十六进制输入">
          <div className="divide-y divide-gray-100">
            <CopyRow label="大端" value={forms.bytesBE} hint="高位字节在前" />
            <CopyRow label="小端" value={forms.bytesLE} hint="低位字节在前" />
          </div>
        </SectionCard>
      </div>
    </ToolLayout>
  );
}
