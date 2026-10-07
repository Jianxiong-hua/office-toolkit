"use client";

import {
  forwardRef,
  memo,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import { ROW_HEIGHT, formatRow, totalLines } from "@/lib/bin/hex";

/** 可视区上下各多渲染的行数，滚动时不会看到空白 */
const OVERSCAN = 5;

export interface HexViewHandle {
  /** 滚动到包含该字节的行 */
  scrollToIndex: (index: number) => void;
  /** 回到文件开头 */
  scrollToTop: () => void;
}

interface HexRowProps {
  bytes: Uint8Array;
  lineIndex: number;
  bytesPerLine: number;
  selectedIndex: number | null;
  hitIndex: number | null;
  onSelectByte: (index: number) => void;
}

const HexRow = memo(function HexRow({
  bytes,
  lineIndex,
  bytesPerLine,
  selectedIndex,
  hitIndex,
  onSelectByte,
}: HexRowProps) {
  const { offset, cells } = formatRow(bytes, lineIndex, bytesPerLine);

  return (
    <div
      className="flex items-center font-mono text-xs"
      // 行高必须与 ROW_HEIGHT 一致，虚拟滚动的像素换算才成立
      style={{ height: ROW_HEIGHT, lineHeight: `${ROW_HEIGHT}px` }}
    >
      <span className="w-20 shrink-0 pr-3 text-right text-gray-400 select-none">
        {offset}
      </span>
      <span className="shrink-0 whitespace-pre">
        {cells.map((cell) => {
          const isSelected = cell.index === selectedIndex;
          const isHit = cell.index === hitIndex;
          return (
            <span
              key={cell.index}
              onClick={() => onSelectByte(cell.index)}
              className={`inline-block w-5 cursor-pointer text-center ${
                isSelected
                  ? "bg-brand-600 text-white"
                  : isHit
                    ? "bg-yellow-300 text-gray-900"
                    : cell.hex === "00"
                      ? "text-gray-300"
                      : "text-gray-800"
              }`}
            >
              {cell.hex}
            </span>
          );
        })}
      </span>
      <span className="ml-4 shrink-0 whitespace-pre text-gray-500">
        {cells.map((cell) => cell.ascii).join("")}
      </span>
    </div>
  );
});

interface HexViewProps {
  bytes: Uint8Array;
  bytesPerLine: number;
  selectedIndex: number | null;
  /** 搜索命中位置，滚动后高亮该字节 */
  hitIndex: number | null;
  onSelectByte: (index: number) => void;
}

export const HexView = forwardRef<HexViewHandle, HexViewProps>(function HexView(
  { bytes, bytesPerLine, selectedIndex, hitIndex, onSelectByte },
  ref
) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(480);

  const lines = totalLines(bytes.length, bytesPerLine);

  // 容器尺寸随窗口变化，需重新测量才能确定渲染多少行
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    setViewportHeight(el.clientHeight);
    const observer = new ResizeObserver(() => setViewportHeight(el.clientHeight));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // 换文件后回到开头
  useEffect(() => {
    const el = containerRef.current;
    if (el) el.scrollTop = 0;
    setScrollTop(0);
  }, [bytes]);

  const handleScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    setScrollTop(e.currentTarget.scrollTop);
  }, []);

  useImperativeHandle(
    ref,
    () => ({
      scrollToIndex: (index: number) => {
        const el = containerRef.current;
        if (!el) return;
        el.scrollTop = Math.floor(index / bytesPerLine) * ROW_HEIGHT;
      },
      scrollToTop: () => {
        const el = containerRef.current;
        if (el) el.scrollTop = 0;
      },
    }),
    [bytesPerLine]
  );

  const startLine = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - OVERSCAN);
  const visibleCount = Math.ceil(viewportHeight / ROW_HEIGHT) + 1;
  const endLine = Math.min(lines, startLine + visibleCount + OVERSCAN * 2);

  const rows: React.ReactNode[] = [];
  for (let i = startLine; i < endLine; i++) {
    rows.push(
      <HexRow
        key={i}
        bytes={bytes}
        lineIndex={i}
        bytesPerLine={bytesPerLine}
        selectedIndex={selectedIndex}
        hitIndex={hitIndex}
        onSelectByte={onSelectByte}
      />
    );
  }

  return (
    <div
      ref={containerRef}
      onScroll={handleScroll}
      className="h-[60vh] overflow-auto rounded-xl border border-gray-200 bg-gray-50 p-3"
    >
      {/* 外层撑出总高度，内层只渲染可视区的行 */}
      <div style={{ height: lines * ROW_HEIGHT, position: "relative" }}>
        <div
          style={{
            position: "absolute",
            top: startLine * ROW_HEIGHT,
            left: 0,
            right: 0,
          }}
        >
          {rows}
        </div>
      </div>
    </div>
  );
});
