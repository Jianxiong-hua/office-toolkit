/** 标注工具：select = 选择/编辑模式，null = 仅查看与调色 */
export type AnnotationTool = "select" | "line" | "rect" | "text" | "crop" | "measure" | null;

export type LineDash = "solid" | "dashed" | "dashdot";

/** SVG strokeDasharray 与 canvas setLineDash 共用同一组数值（原图像素），保证预览与导出一致 */
export const DASH_ARRAYS: Record<LineDash, number[] | null> = {
  solid: null,
  dashed: [12, 8],
  dashdot: [12, 6, 3, 6],
};

interface BaseAnnotation {
  id: number;
  color: string;
  strokeWidth: number;
  dash: LineDash;
}

export interface LineAnnotation extends BaseAnnotation {
  type: "line";
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export interface RectAnnotation extends BaseAnnotation {
  type: "rect";
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  /** 填充色（与描边色独立选择） */
  fillColor: string;
  /** 填充不透明度 0-1，0 = 不填充 */
  fillOpacity: number;
}

export interface TextAnnotation extends BaseAnnotation {
  type: "text";
  /** 首行顶部锚点（原图像素） */
  x: number;
  y: number;
  /** 手动换行，用 \n 分隔 */
  text: string;
  fontSize: number;
}

/** 距离测量线：固定灰色虚线 + 端点坐标与距离标签，样式不受颜色面板影响 */
export interface MeasureAnnotation extends BaseAnnotation {
  type: "measure";
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export type Annotation = LineAnnotation | RectAnnotation | TextAnnotation | MeasureAnnotation;

export const ANNOTATION_COLORS = [
  "#ef4444",
  "#eab308",
  "#22c55e",
  "#3b82f6",
  "#ffffff",
  "#111111",
] as const;

export const STROKE_WIDTH_OPTIONS = [1, 2, 3, 4, 6] as const;
export const FONT_SIZE_OPTIONS = [16, 24, 32, 48, 64] as const;
export const DEFAULT_STROKE_WIDTH = 3;
export const DEFAULT_FONT_SIZE = 32;
export const DEFAULT_COLOR = ANNOTATION_COLORS[0];
export const MEASURE_COLOR = "#6b7280";
/** 新建矩形的默认填充不透明度 */
export const DEFAULT_FILL_OPACITY = 0.5;
/** 测量线标签字号（原图像素），SVG 渲染时按 displayScale 反比缩小保持视觉恒定 */
export const MEASURE_LABEL_SIZE = 13;
/** 文本行高倍数，SVG 与 canvas 共用同一公式 */
export const TEXT_LINE_HEIGHT = 1.4;
