/** 标注工具：select = 选择/编辑模式，null = 仅查看与调色 */
export type AnnotationTool = "select" | "line" | "rect" | "text" | null;

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

export type Annotation = LineAnnotation | RectAnnotation | TextAnnotation;

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
/** 文本行高倍数，SVG 与 canvas 共用同一公式 */
export const TEXT_LINE_HEIGHT = 1.4;
