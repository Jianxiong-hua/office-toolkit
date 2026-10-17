"use client";

import { useEffect, useRef, useState } from "react";
import {
  DASH_ARRAYS,
  DEFAULT_FILL_OPACITY,
  MEASURE_COLOR,
  MEASURE_LABEL_SIZE,
  TEXT_LINE_HEIGHT,
  type Annotation,
  type AnnotationTool,
  type MeasureAnnotation,
  type TextAnnotation,
} from "./types";

type DragMode =
  | { kind: "move"; id: number; startX: number; startY: number; orig: Annotation }
  | { kind: "handle"; id: number; index: number; orig: Annotation };

interface AnnotationCanvasProps {
  naturalWidth: number;
  naturalHeight: number;
  annotations: Annotation[];
  tool: AnnotationTool;
  color: string;
  strokeWidth: number;
  dash: "solid" | "dashed" | "dashdot";
  fontSize: number;
  /** 新建矩形的默认填充色与不透明度（0-1） */
  fillColor: string;
  fillOpacity: number;
  /** 当前内容显示缩放（fit × zoom），用于让手柄视觉大小恒定 */
  displayScale: number;
  selectedId: number | null;
  onSelect: (id: number | null) => void;
  /** 拖拽创建新元素 */
  onCreate: (a: Annotation) => void;
  /** 拖拽/手柄过程中的实时更新（不走撤销栈） */
  onUpdate: (id: number, patch: Partial<Annotation>) => void;
  /** 拖动开始时由 page 记录快照；结束时若有位移则入栈 */
  onDragStart: () => void;
  onDragEnd: (changed: boolean) => void;
  /** 文本：单击创建锚点、双击重编辑 */
  onTextCreate: (x: number, y: number) => void;
  onTextEdit: (id: number) => void;
  /** 裁剪模式：拖出选区后提交（原图像素坐标） */
  onCropSelect: (rect: { x1: number; y1: number; x2: number; y2: number }) => void;
  /** 已确认待应用的裁剪选区（渲染遮罩与虚线框） */
  cropRect: { x1: number; y1: number; x2: number; y2: number } | null;
}

/** 手柄视觉大小恒定：viewBox 坐标系下除以显示缩放 */
const handleR = (displayScale: number) => 6 / Math.max(displayScale, 0.0001);

/** 测量线标签内容：两端坐标 + 欧氏距离（像素）。SVG 与 canvas 导出共用同一格式 */
export function measureLabel(a: MeasureAnnotation): string {
  const x1 = Math.round(a.x1);
  const y1 = Math.round(a.y1);
  const x2 = Math.round(a.x2);
  const y2 = Math.round(a.y2);
  const d = Math.round(Math.hypot(a.x2 - a.x1, a.y2 - a.y1));
  return "(" + x1 + "," + y1 + ") -> (" + x2 + "," + y2 + ") · " + d + " px";
}
function shapeTouches(a: Annotation, x: number, y: number, displayScale: number): boolean {
  const slack = 8 / Math.max(displayScale, 0.0001);
  if (a.type === "text") {
    const w = Math.max(...a.text.split("\n").map((l) => l.length)) * a.fontSize * 0.6 + a.fontSize;
    const h = a.text.split("\n").length * a.fontSize * TEXT_LINE_HEIGHT;
    return x >= a.x - slack && x <= a.x + w + slack && y >= a.y - slack && y <= a.y + h + slack;
  }
  const minX = Math.min(a.x1, a.x2) - slack;
  const maxX = Math.max(a.x1, a.x2) + slack;
  const minY = Math.min(a.y1, a.y2) - slack;
  const maxY = Math.max(a.y1, a.y2) + slack;
  return x >= minX && x <= maxX && y >= minY && y <= maxY;
}

export function AnnotationCanvas({
  naturalWidth,
  naturalHeight,
  annotations,
  tool,
  color,
  strokeWidth,
  dash,
  fontSize,
  fillColor,
  fillOpacity,
  displayScale,
  selectedId,
  onSelect,
  onCreate,
  onUpdate,
  onDragStart,
  onDragEnd,
  onTextCreate,
  onTextEdit,
  onCropSelect,
  cropRect,
}: AnnotationCanvasProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [draft, setDraft] = useState<Annotation | null>(null);
  const dragRef = useRef<DragMode | null>(null);
  const [dragging, setDragging] = useState(false);

  // 切换工具时丢弃草稿：避免「按住拖动中切到别的工具再松手」把上一个工具的草稿误创建为标注
  useEffect(() => {
    setDraft(null);
  }, [tool]);

  const toLocal = (e: React.PointerEvent): { x: number; y: number } => {
    const rect = svgRef.current!.getBoundingClientRect();
    const scale = Math.min(rect.width / naturalWidth, rect.height / naturalHeight);
    return {
      x: (e.clientX - rect.left - (rect.width - naturalWidth * scale) / 2) / scale,
      y: (e.clientY - rect.top - (rect.height - naturalHeight * scale) / 2) / scale,
    };
  };

  const nextId = () => -Date.now();

  const handleDown = (e: React.PointerEvent) => {
    if (!tool) return;
    if (tool === 'select') { onSelect(null); return; }
    const { x, y } = toLocal(e);
    if (tool === "text") {
      onTextCreate(Math.round(x), Math.round(y));
      return;
    }
    if (tool !== "line" && tool !== "rect" && tool !== "crop" && tool !== "measure") return;
    e.currentTarget.setPointerCapture(e.pointerId);
    const base = {
      id: nextId(),
      color: tool === "measure" ? MEASURE_COLOR : color,
      strokeWidth: tool === "measure" ? 2 : strokeWidth,
      dash: tool === "measure" ? ("dashed" as const) : dash,
      x1: x,
      y1: y,
      x2: x,
      y2: y,
    };
    // 裁剪借用矩形绘制选区（提交走 onCropSelect，不会成为标注）；rect 草稿带填充属性
    if (tool === "crop" || tool === "rect") {
      setDraft({ ...base, type: "rect", fillColor, fillOpacity });
    } else if (tool === "measure") {
      setDraft({ ...base, type: "measure" });
    } else {
      setDraft({ ...base, type: "line" });
    }
  };

  const handleMove = (e: React.PointerEvent) => {
    const { x: px, y: py } = toLocal(e);
    const drag = dragRef.current;
    if (drag) {
      const a = annotations.find((it) => it.id === drag.id);
      if (!a) return;
      if (drag.kind === "move") {
        const dx = px - drag.startX;
        const dy = py - drag.startY;
        const o = drag.orig;
        if (o.type === "text") onUpdate(a.id, { x: o.x + dx, y: o.y + dy });
        else onUpdate(a.id, { x1: o.x1 + dx, y1: o.y1 + dy, x2: o.x2 + dx, y2: o.y2 + dy });
      } else {
        const idx = drag.index;
        const o = drag.orig;
        if ((a.type === "line" || a.type === "measure") && (o.type === "line" || o.type === "measure")) {
          onUpdate(a.id, (idx === 0 ? { x1: px, y1: py } : { x2: px, y2: py }) as Partial<Annotation>);
        } else if (a.type === "rect" && o.type === "rect") {
          const corners = [
            { x1: px, y1: py, x2: o.x2, y2: o.y2 },
            { x1: o.x1, y1: py, x2: px, y2: o.y2 },
            { x1: px, y1: o.y1, x2: o.x2, y2: py },
            { x1: o.x1, y1: o.y1, x2: px, y2: py },
          ];
          onUpdate(a.id, corners[idx] as Partial<Annotation>);
        }
      }
      return;
    }
    if (!draft || draft.type === "text") return;
    let x = px;
    let y = py;
    if ((draft.type === "line" || draft.type === "measure") && e.shiftKey) {
      if (Math.abs(x - draft.x1) >= Math.abs(y - draft.y1)) y = draft.y1;
      else x = draft.x1;
    }
    setDraft({ ...draft, x2: x, y2: y });
  };

  const handleUp = () => {
    const drag = dragRef.current;
    if (drag) {
      dragRef.current = null;
      setDragging(false);
      // 只有实际发生位移才入撤销栈，避免「点选但未拖动」污染历史
      const cur = annotations.find((it) => it.id === drag.id);
      const changed =
        !!cur && JSON.stringify(cur) !== JSON.stringify(drag.orig);
      onDragEnd(changed);
      return;
    }
    if (!draft || draft.type === "text") return;
    const moved = Math.abs(draft.x2 - draft.x1) > 2 || Math.abs(draft.y2 - draft.y1) > 2;
    if (moved) {
      if (tool === "crop") {
        onCropSelect({
          x1: Math.min(draft.x1, draft.x2),
          y1: Math.min(draft.y1, draft.y2),
          x2: Math.max(draft.x1, draft.x2),
          y2: Math.max(draft.y1, draft.y2),
        });
      } else {
        onCreate(draft);
      }
    }
    setDraft(null);
  };

  const startSelect = (e: React.PointerEvent, a: Annotation) => {
    if (tool !== 'select') return;
    e.stopPropagation();
    (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
    onSelect(a.id);
    const { x, y } = toLocal(e);
    dragRef.current = { kind: 'move', id: a.id, startX: x, startY: y, orig: a };
    setDragging(true);
    onDragStart();
  };

  const startHandle = (e: React.PointerEvent, a: Annotation, index: number) => {
    e.stopPropagation();
    (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
    dragRef.current = { kind: 'handle', id: a.id, index, orig: a };
    setDragging(true);
    onDragStart();
  };

  const renderShape = (a: Annotation, key: string, selected: boolean) => {
    const dashArray = DASH_ARRAYS[a.dash];
    const strokeProps = {
      stroke: a.color,
      strokeWidth: a.strokeWidth,
      strokeDasharray: dashArray ? dashArray.join(' ') : undefined,
    };

    let node: React.ReactNode;
    if (a.type === 'line') {
      node = <line key={key} x1={a.x1} y1={a.y1} x2={a.x2} y2={a.y2} {...strokeProps} strokeLinecap='round' />;
    } else if (a.type === 'rect') {
      node = <rect key={key} x={Math.min(a.x1, a.x2)} y={Math.min(a.y1, a.y2)} width={Math.abs(a.x2 - a.x1)} height={Math.abs(a.y2 - a.y1)} fill={a.fillColor} fillOpacity={a.fillOpacity} {...strokeProps} />;
    } else if (a.type === 'measure') {
      node = (
        <g key={key}>
          <line
            x1={a.x1}
            y1={a.y1}
            x2={a.x2}
            y2={a.y2}
            stroke={MEASURE_COLOR}
            strokeWidth={a.strokeWidth}
            strokeDasharray="8 5"
            strokeLinecap="round"
          />
          <circle cx={a.x1} cy={a.y1} r={3 / displayScale} fill={MEASURE_COLOR} />
          <circle cx={a.x2} cy={a.y2} r={3 / displayScale} fill={MEASURE_COLOR} />
          <text
            x={(a.x1 + a.x2) / 2}
            y={(a.y1 + a.y2) / 2 - 6 / displayScale}
            fontSize={MEASURE_LABEL_SIZE / displayScale}
            fill="#374151"
            textAnchor="middle"
            style={{ fontFamily: 'sans-serif', userSelect: 'none' }}
          >
            {measureLabel(a)}
          </text>
        </g>
      );
    } else {
      const baseline0 = a.y + a.fontSize * 0.9;
      node = (
        <text key={key} x={a.x} y={baseline0} fill={a.color} fontSize={a.fontSize} style={{ fontFamily: 'sans-serif', userSelect: 'none' }}>
          {a.text.split(String.fromCharCode(10)).map((line, i) => (
            <tspan key={i} x={a.x} dy={i === 0 ? 0 : a.fontSize * TEXT_LINE_HEIGHT}>{line === '' ? ' ' : line}</tspan>
          ))}
        </text>
      );
    }
    return node;
  };

  /** 估算文本包围盒（不依赖 measure，够选择命中与高亮框用） */
  const textBBox = (a: TextAnnotation) => {
    const lines = a.text.split(String.fromCharCode(10));
    const w = Math.max(1, ...lines.map((l) => l.length)) * a.fontSize * 0.62 + a.fontSize;
    const h = lines.length * a.fontSize * TEXT_LINE_HEIGHT;
    return { x: a.x, y: a.y, w, h };
  };

  const bboxOf = (a: Annotation) => {
    if (a.type === 'text') return textBBox(a);
    return { x: Math.min(a.x1, a.x2), y: Math.min(a.y1, a.y2), w: Math.abs(a.x2 - a.x1), h: Math.abs(a.y2 - a.y1) };
  };

  const selected = tool === 'select' ? annotations.find((a) => a.id === selectedId) ?? null : null;
  const r = handleR(displayScale);

  const startPointHandle = (a: Annotation, index: number, cx: number, cy: number) => (
    <circle key={'h' + index} cx={cx} cy={cy} r={r} fill='#ffffff' stroke='#3b82f6' strokeWidth={2 / displayScale}
      style={{ cursor: 'crosshair' }} onPointerDown={(e) => startHandle(e, a, index)} />
  );

  return (
    <svg
      ref={svgRef}
      viewBox={`0 0 ${naturalWidth} ${naturalHeight}`}
      preserveAspectRatio='xMidYMid meet'
      onPointerDown={handleDown}
      onPointerMove={handleMove}
      onPointerUp={handleUp}
      className={`absolute inset-0 h-full w-full ${tool === 'select' ? '' : tool ? 'cursor-crosshair' : ''}`}
    >
      {annotations.map((a, i) => renderShape(a, 'a' + i, a.id === selectedId))}
      {draft && renderShape(draft, 'draft', false)}

      {/* 裁剪选区：选区外半透明遮罩（4 段）+ 虚线框 */}
      {cropRect && (
        <>
          {(() => {
            const x1 = Math.min(cropRect.x1, cropRect.x2);
            const y1 = Math.min(cropRect.y1, cropRect.y2);
            const x2 = Math.max(cropRect.x1, cropRect.x2);
            const y2 = Math.max(cropRect.y1, cropRect.y2);
            const dim = 'rgba(0,0,0,0.5)';
            return (
              <g pointerEvents="none">
                <rect x={0} y={0} width={naturalWidth} height={y1} fill={dim} />
                <rect x={0} y={y2} width={naturalWidth} height={naturalHeight - y2} fill={dim} />
                <rect x={0} y={y1} width={x1} height={y2 - y1} fill={dim} />
                <rect x={x2} y={y1} width={naturalWidth - x2} height={y2 - y1} fill={dim} />
                <rect
                  x={x1}
                  y={y1}
                  width={x2 - x1}
                  height={y2 - y1}
                  fill="none"
                  stroke="#3b82f6"
                  strokeWidth={2 / displayScale}
                  strokeDasharray={`${8 / displayScale} ${5 / displayScale}`}
                />
              </g>
            );
          })()}
        </>
      )}

      {/* 选择模式：透明命中层（本体描边加宽或文本包围盒） */}
      {tool === 'select' &&
        annotations.map((a) => {
          const pick = (e: React.PointerEvent) => startSelect(e, a);
          // 测量线与普通线同样用加宽透明线做命中区
          if (a.type === 'line' || a.type === 'measure')
            return <line key={'p' + a.id} x1={a.x1} y1={a.y1} x2={a.x2} y2={a.y2} stroke='transparent' strokeWidth={a.strokeWidth + 10 / displayScale} strokeLinecap='round' style={{ cursor: 'move' }} onPointerDown={pick} />;
          if (a.type === 'rect')
            return <rect key={'p' + a.id} x={Math.min(a.x1, a.x2)} y={Math.min(a.y1, a.y2)} width={Math.abs(a.x2 - a.x1)} height={Math.abs(a.y2 - a.y1)} fill='transparent' stroke='transparent' strokeWidth={10 / displayScale} style={{ cursor: 'move' }} onPointerDown={pick} />;
          const b = textBBox(a);
          return <rect key={'p' + a.id} x={b.x} y={b.y} width={b.w} height={b.h} fill='transparent' style={{ cursor: 'move' }} onPointerDown={pick} onDoubleClick={() => onTextEdit(a.id)} />;
        })}

      {/* 选中高亮框与手柄 */}
      {selected && (
        <>
          {(() => {
            const b = bboxOf(selected);
            const pad = 4 / displayScale;
            return <rect x={b.x - pad} y={b.y - pad} width={b.w + pad * 2} height={b.h + pad * 2} fill='none' stroke='#3b82f6' strokeWidth={1.5 / displayScale} strokeDasharray={`${6 / displayScale} ${4 / displayScale}`} pointerEvents='none' />;
          })()}
          {(selected.type === 'line' || selected.type === 'measure') && (
            <>
              {startPointHandle(selected, 0, selected.x1, selected.y1)}
              {startPointHandle(selected, 1, selected.x2, selected.y2)}
            </>
          )}
          {selected.type === 'rect' && (
            <>
              {startPointHandle(selected, 0, Math.min(selected.x1, selected.x2), Math.min(selected.y1, selected.y2))}
              {startPointHandle(selected, 1, Math.max(selected.x1, selected.x2), Math.min(selected.y1, selected.y2))}
              {startPointHandle(selected, 2, Math.min(selected.x1, selected.x2), Math.max(selected.y1, selected.y2))}
              {startPointHandle(selected, 3, Math.max(selected.x1, selected.x2), Math.max(selected.y1, selected.y2))}
            </>
          )}
        </>
      )}
    </svg>
  );
}
