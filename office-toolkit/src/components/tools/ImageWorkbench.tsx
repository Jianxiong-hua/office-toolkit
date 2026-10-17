"use client";

import { useCallback, useEffect, useRef, useState } from "react";
const ZOOM_MIN = 0.05;
const ZOOM_MAX = 8;

interface ImageWorkbenchProps {
  naturalWidth: number;
  naturalHeight: number;
  /** 渲染于内容层（wrapper）内，调用方自行 absolute inset-0 填满 */
  children: React.ReactNode;
  /** 容器高度类，默认 h-[75vh] */
  heightClass?: string;
  /** 显示缩放变化回调（需要感知 scale 的子内容，如恒定大小的手柄） */
  onScaleChange?: (scale: number) => void;
}

/**
 * 图片工作台：固定高度滚动容器 + fit 初始缩放 + 滚轮锚点缩放。
 * 关键实现约束（踩坑记录见 memory/2026-10-11.md）：
 * - 滚轮缩放的 wrapper 尺寸与滚动位置必须在同一事件内同步写 DOM，
 *   setState 后靠 rAF 再调 scroll 会产生「旧尺寸 + 新滚动」的闪烁中间帧；
 * - ResizeObserver 只更新 fitScaleRef，不得重置当前缩放，
 *   否则放大出现滚动条 -> clientWidth 变化 -> zoom 被拉回 fit（放大无效）。
 */
export function ImageWorkbench({
  naturalWidth,
  naturalHeight,
  children,
  heightClass = "h-[75vh]",
  onScaleChange,
}: ImageWorkbenchProps) {
  const [displayScale, setDisplayScale] = useState(1);
  const workbenchRef = useRef<HTMLDivElement>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const fitScaleRef = useRef(1);

  useEffect(() => {
    onScaleChange?.(displayScale);
  }, [displayScale, onScaleChange]);

  // fit：图片变化时测量并应用一次；之后 ResizeObserver 只更新基准
  useEffect(() => {
    const el = workbenchRef.current;
    if (!el || !naturalWidth || !naturalHeight) return;
    const measure = () => {
      const s = Math.min(el.clientWidth / naturalWidth, el.clientHeight / naturalHeight);
      return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, s));
    };
    fitScaleRef.current = measure();
    setDisplayScale(fitScaleRef.current);
    const observer = new ResizeObserver(() => {
      fitScaleRef.current = measure();
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [naturalWidth, naturalHeight]);

  // 滚轮锚点缩放：同步写 wrapper 尺寸与滚动，React 状态只做随后对齐
  useEffect(() => {
    const el = workbenchRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      const wrapper = wrapperRef.current;
      if (!wrapper || !naturalWidth || !naturalHeight) return;
      e.preventDefault();
      const factor = e.deltaY < 0 ? 1.1 : 1 / 1.1;
      const cur = displayScale;
      const next = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, cur * factor));
      if (next === cur) return;
      const px = e.clientX - el.getBoundingClientRect().left;
      const py = e.clientY - el.getBoundingClientRect().top;
      const ratioX = (el.scrollLeft + px) / (naturalWidth * cur);
      const ratioY = (el.scrollTop + py) / (naturalHeight * cur);
      wrapper.style.width = naturalWidth * next + "px";
      wrapper.style.height = naturalHeight * next + "px";
      el.scrollLeft = ratioX * naturalWidth * next - px;
      el.scrollTop = ratioY * naturalHeight * next - py;
      setDisplayScale(next);
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [displayScale, naturalWidth, naturalHeight]);

  const fitToWindow = useCallback(() => {
    setDisplayScale(fitScaleRef.current);
  }, []);

  return (
    <div className="min-w-0 space-y-2">
      <div className="flex items-center gap-2 text-xs text-gray-500">
        <button
          onClick={fitToWindow}
          className="rounded-lg border border-gray-200 px-2 py-1 transition-colors hover:bg-gray-50"
        >
          适应窗口
        </button>
        <button
          onClick={() => setDisplayScale(1)}
          className="rounded-lg border border-gray-200 px-2 py-1 transition-colors hover:bg-gray-50"
        >
          100%
        </button>
        <span className="font-mono">{Math.round(displayScale * 100)}%</span>
        <span className="hidden text-gray-400 sm:inline">滚轮缩放</span>
      </div>
      <div ref={workbenchRef} className={`${heightClass} overflow-auto rounded-xl border border-gray-200 bg-gray-100`}>
        <div
          ref={wrapperRef}
          className="relative"
          style={{
            width: naturalWidth * displayScale,
            height: naturalHeight * displayScale,
          }}
        >
          {children}
        </div>
      </div>
    </div>
  );
}
