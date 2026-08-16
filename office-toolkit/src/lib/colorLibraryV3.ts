/**
 * 颜色库 v3 模型：无角色属性 + HSV 比例公式 + 校验对 + CSV 导入导出
 */
import {
  evalHsvLinked,
  isValidHsvFormula,
  type HsvTuple,
  type RgbTuple,
} from "./color/formula";
import {
  hexToRgb as _hexToRgb,
  rgbToHex as _rgbToHex,
  rgbToHsv,
  hsvToRgb,
} from "./color/convert";

/* ============ 类型 ============ */

export interface HsvFormula {
  h: string;
  s: string;
  v: string;
}

export interface LibraryColor {
  id: string;
  name: string;
  /** 实际生效 RGB（派生色由公式计算） */
  rgb: RgbTuple;
  /** 手动基准 RGB（派生色在公式失效/源缺失时回退） */
  baseRgb: RgbTuple;
  /** 链接到其他颜色（派生色） */
  linked: boolean;
  /** 链接目标颜色 id */
  linkTargetId: string | null;
  /** HSV 比例公式（仅 linked=true 有效） */
  linkFormula: HsvFormula | null;
}

export interface ColorLibrary {
  colors: LibraryColor[]; // 有序数组（拖拽排序即数组顺序）
}

/** 校验色彩对：一个文字色 × 一个背景色（含文字不透明度） */
export interface PairItem {
  id: string;
  textColorId: string;
  bgColorId: string;
  /** 文字不透明度 0-100（默认 100） */
  textOpacity: number;
}

export type LibraryState = "ok" | "error";

export interface ResolvedColor extends LibraryColor {
  status: LibraryState;
  error?: string;
  /** 派生色的实际 HSV（由公式计算） */
  hsv: HsvTuple;
}

/* ============ 工具函数 ============ */

function rgbToTuple(rgb: { r: number; g: number; b: number }): RgbTuple {
  return [rgb.r, rgb.g, rgb.b];
}

export function hexToRgbTuple(hex: string): RgbTuple | null {
  const rgb = _hexToRgb(hex);
  return rgb ? rgbToTuple(rgb) : null;
}

export function colorToHex(rgb: RgbTuple): string {
  return _rgbToHex(rgb[0], rgb[1], rgb[2]).toUpperCase();
}

export function rgbToHsvTuple(rgb: RgbTuple): HsvTuple {
  const h = rgbToHsv(rgb[0], rgb[1], rgb[2]);
  return { h: h.h, s: h.s, v: h.v };
}

export function hsvToRgbTuple(hsv: HsvTuple): RgbTuple {
  const r = hsvToRgb(hsv.h, hsv.s, hsv.v);
  return [r.r, r.g, r.b];
}

/* ============ 初始 6 色 ============ */

const DEFAULT_RGB: RgbTuple = [0, 0, 0];

export function createDefaultLibraryV3(): ColorLibrary {
  const mk = (name: string, hex: string): LibraryColor => {
    const parsed = _hexToRgb(hex);
    const rgb = parsed ? rgbToTuple(parsed) : DEFAULT_RGB;
    return {
      id: "c" + name,
      name,
      rgb,
      baseRgb: rgb,
      linked: false,
      linkTargetId: null,
      linkFormula: null,
    };
  };
  return {
    colors: [
      mk("红", "#FF0000"),
      mk("绿", "#00FF00"),
      mk("蓝", "#0000FF"),
      mk("白", "#FFFFFF"),
      mk("灰", "#808080"),
      mk("黑", "#000000"),
    ],
  };
}

/* ============ 派生色联动（HSV 公式） ============ */

/**
 * 解析整个颜色库：派生色按 HSV 公式从源色计算，支持链式联动，DFS 防循环。
 */
export function resolveLibraryV3(library: ColorLibrary): ResolvedColor[] {
  const colors = library.colors;
  const byId = new Map(colors.map((c) => [c.id, c]));
  const result = new Map<string, ResolvedColor>();
  const visiting = new Set<string>();

  const resolve = (c: LibraryColor): ResolvedColor => {
    const cached = result.get(c.id);
    if (cached) return cached;

    if (visiting.has(c.id)) {
      return {
        ...c,
        rgb: c.baseRgb,
        hsv: rgbToHsvTuple(c.baseRgb),
        status: "error",
        error: "循环引用",
      };
    }

    if (!c.linked || !c.linkTargetId) {
      const r: ResolvedColor = {
        ...c,
        rgb: c.rgb,
        hsv: rgbToHsvTuple(c.rgb),
        status: "ok",
      };
      result.set(c.id, r);
      return r;
    }

    const target = byId.get(c.linkTargetId);
    if (!target) {
      const r: ResolvedColor = {
        ...c,
        rgb: c.baseRgb,
        hsv: rgbToHsvTuple(c.baseRgb),
        status: "error",
        error: `链接目标「${c.linkTargetId}」不存在`,
      };
      result.set(c.id, r);
      return r;
    }

    visiting.add(c.id);
    const targetResolved = resolve(target);
    visiting.delete(c.id);

    if (targetResolved.status === "error" || !c.linkFormula) {
      const r: ResolvedColor = {
        ...c,
        rgb: c.baseRgb,
        hsv: rgbToHsvTuple(c.baseRgb),
        status: "error",
        error: targetResolved.error || "未配置链接公式",
      };
      result.set(c.id, r);
      return r;
    }

    const srcHsv = targetResolved.hsv;
    const hsv = evalHsvLinked(c.linkFormula, srcHsv);
    if (!hsv) {
      const r: ResolvedColor = {
        ...c,
        rgb: c.baseRgb,
        hsv: rgbToHsvTuple(c.baseRgb),
        status: "error",
        error: "链接公式非法",
      };
      result.set(c.id, r);
      return r;
    }

    const r: ResolvedColor = {
      ...c,
      rgb: hsvToRgbTuple(hsv),
      hsv,
      status: "ok",
    };
    result.set(c.id, r);
    return r;
  };

  for (const c of colors) resolve(c);
  return colors.map((c) => result.get(c.id)!);
}

/* ============ CSV 导入导出 ============ */

export interface CsvImportResult {
  colors: LibraryColor[];
  errors: string[];
}

const CSV_HEADERS = ["名称", "HEX"];

/** 生成 CSV 模板文本（名称 + HEX，不含链接） */
export function buildCsvTemplateV3(): string {
  const rows = [
    CSV_HEADERS.join(","),
    "红,#FF0000",
    "黑,#000000",
    "品牌蓝,#2E4FA3",
  ];
  return "\ufeff" + rows.join("\r\n");
}

/** 简单 CSV 行解析（支持引号） */
function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQuote = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuote) {
      if (ch === '"') {
        if (line[i + 1] === '"') { cur += '"'; i++; }
        else inQuote = false;
      } else cur += ch;
    } else if (ch === '"') inQuote = true;
    else if (ch === ",") { out.push(cur.trim()); cur = ""; }
    else cur += ch;
  }
  out.push(cur.trim());
  return out;
}

function parseNum(v: string): number | null {
  const n = Number((v || "").trim());
  return Number.isFinite(n) ? n : null;
}

/** 解析 v3 颜色库 CSV（名称 + HEX，不支持链接） */
export function parseColorCsvV3(text: string): CsvImportResult {
  const errors: string[] = [];
  const colors: LibraryColor[] = [];
  const lines = text.replace(/^\ufeff/, "").split(/\r?\n/);
  const nameSet = new Set<string>();

  if (lines.length < 1) return { colors, errors: ["文件为空"] };
  if (!lines[0].includes("名称") || !lines[0].includes("HEX")) {
    return { colors, errors: ["首行必须是表头：名称, HEX"] };
  }

  for (let i = 1; i < lines.length; i++) {
    const raw = lines[i].trim();
    if (!raw) continue;
    const [nameRaw, hexRaw] = parseCsvLine(raw);
    const name = (nameRaw || "").trim();
    if (!name) { errors.push(`第 ${i + 1} 行：缺少名称`); continue; }
    if (nameSet.has(name)) { errors.push(`第 ${i + 1} 行：名称「${name}」重复`); continue; }
    nameSet.add(name);

    const rgb = hexToRgbTuple(hexRaw || "");
    if (!rgb) {
      errors.push(`第 ${i + 1} 行：HEX 格式无效（应为 #RRGGBB，如 #FF0000）`);
      continue;
    }

    colors.push({
      id: "import_" + (i + 1),
      name,
      rgb,
      baseRgb: rgb,
      linked: false,
      linkTargetId: null,
      linkFormula: null,
    });
  }

  if (colors.length === 0) errors.push("未解析到任何有效的颜色行");
  return { colors, errors };
}

/** 导出 v3 颜色库 CSV（名称 + HEX；链接色导出其实际 HEX） */
export function buildLibraryCsvV3(library: ColorLibrary): string {
  const rows = [CSV_HEADERS.join(",")];
  for (const c of library.colors) {
    rows.push([c.name, colorToHex(c.rgb)].join(","));
  }
  return "\ufeff" + rows.join("\r\n");
}
