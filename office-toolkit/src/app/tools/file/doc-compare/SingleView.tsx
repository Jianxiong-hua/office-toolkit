"use client";

/** 单文档查看：行号 + 等宽文本，固定行高保证与对比视图观感一致 */
export function SingleView({ lines }: { lines: string[] }) {
  return (
    <div className="h-[70vh] overflow-auto rounded-xl border border-gray-200 bg-white">
      <div className="min-w-max py-2 font-mono text-xs">
        {lines.map((line, i) => (
          <div key={i} className="flex h-6 items-center hover:bg-gray-50">
            <span className="w-14 shrink-0 pr-3 text-right text-gray-300 select-none">
              {i + 1}
            </span>
            <span className="whitespace-pre pr-4 text-gray-800">
              {line === "" ? " " : line}
            </span>
          </div>
        ))}
        {lines.length === 0 && (
          <p className="px-4 py-6 text-center text-gray-400">文档为空</p>
        )}
      </div>
    </div>
  );
}
