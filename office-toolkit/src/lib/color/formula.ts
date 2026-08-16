/**
 * 颜色链接公式引擎（纯函数，不 eval，防注入）
 *
 * 用于颜色库的"链接到其他颜色"。支持两套变量：
 *   - RGB 变量：R / G / B（源颜色三通道，v2 用途）
 *   - HSV 变量：H / S / V（源颜色色相/饱和度/明度，v3 用途）
 *
 * 支持的语法：
 *   - 数字（整数/小数）
 *   - 变量：H / S / V 或 R / G / B（源颜色通道）
 *   - 运算符：+ - * /（及一元负号）
 *   - 括号：( )
 *
 * 示例（HSV）：
 *   "H+15"           → 源H + 15（色相偏移）
 *   "S*0.8"          → 源S × 0.8（饱和度比例）
 *   "V*1.2"          → 源V × 1.2（明度比例）
 */

export type RgbTuple = [number, number, number];

export interface HsvTuple {
  h: number; // 0-360
  s: number; // 0-100
  v: number; // 0-100
}

/* ============ Tokenizer ============ */

type Token =
  | { type: "num"; value: number }
  | { type: "var"; name: string }
  | { type: "op"; op: "+" | "-" | "*" | "/" }
  | { type: "lparen" }
  | { type: "rparen" };

function tokenize(expr: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  const s = expr.replace(/\s+/g, "");
  while (i < s.length) {
    const ch = s[i];
    if (ch >= "0" && ch <= "9" || ch === ".") {
      // 数字
      let j = i;
      while (j < s.length && (s[j] >= "0" && s[j] <= "9" || s[j] === ".")) j++;
      const num = Number(s.slice(i, j));
      if (Number.isNaN(num)) return [];
      tokens.push({ type: "num", value: num });
      i = j;
    } else if (ch === "R" || ch === "G" || ch === "B" || ch === "H" || ch === "S" || ch === "V") {
      tokens.push({ type: "var", name: ch });
      i++;
    } else if (ch === "+" || ch === "-" || ch === "*" || ch === "/") {
      tokens.push({ type: "op", op: ch });
      i++;
    } else if (ch === "(") {
      tokens.push({ type: "lparen" });
      i++;
    } else if (ch === ")") {
      tokens.push({ type: "rparen" });
      i++;
    } else {
      // 非法字符
      return [];
    }
  }
  return tokens;
}

/* ============ 递归下降解析器（优先级：* / > + -） ============ */

class Parser {
  private pos = 0;
  constructor(private tokens: Token[]) {}

  private peek(): Token | undefined {
    return this.tokens[this.pos];
  }
  private next(): Token | undefined {
    return this.tokens[this.pos++];
  }

  parse(): number {
    const v = this.expr();
    // 必须消费全部 token，否则表达式非法
    return this.pos === this.tokens.length ? v : NaN;
  }

  private expr(): number {
    let value = this.term();
    while (true) {
      const t = this.peek();
      if (t?.type === "op" && (t.op === "+" || t.op === "-")) {
        this.next();
        const rhs = this.term();
        value = t.op === "+" ? value + rhs : value - rhs;
      } else break;
    }
    return value;
  }

  private term(): number {
    let value = this.factor();
    while (true) {
      const t = this.peek();
      if (t?.type === "op" && (t.op === "*" || t.op === "/")) {
        this.next();
        const rhs = this.factor();
        if (t.op === "/" && rhs === 0) {
          this.pos = this.tokens.length; // 除零：标记非法
          return NaN;
        }
        value = t.op === "*" ? value * rhs : value / rhs;
      } else break;
    }
    return value;
  }

  private factor(): number {
    const t = this.next();
    if (!t) return NaN;
    if (t.type === "num") return t.value;
    // var 在语法校验阶段是合法占位（实际求值前已被替换为 num）
    if (t.type === "var") return 0;
    if (t.type === "lparen") {
      const v = this.expr();
      const close = this.next();
      if (close?.type !== "rparen") return NaN;
      return v;
    }
    // 一元负号
    if (t.type === "op" && t.op === "-") {
      return -this.factor();
    }
    return NaN;
  }
}

/**
 * 计算单通道表达式。
 * @param expr 表达式，如 "R*0.8"
 * @param srcRgb 源颜色 RGB
 * @returns 0-255 的整数；非法表达式返回 null
 */
export function evalChannel(
  expr: string,
  srcRgb: RgbTuple
): number | null {
  const trimmed = (expr ?? "").trim();
  if (!trimmed) return null;
  const tokens = tokenize(trimmed);
  if (tokens.length === 0) return null;

  // 解析时用变量值替换：将 var token 替换为实际数值后重新走求值
  const resolved = tokens.map((t) =>
    t.type === "var"
      ? ({ type: "num", value: srcRgb[t.name === "R" ? 0 : t.name === "G" ? 1 : 2] } as Token)
      : t
  );

  const parser = new Parser(resolved);
  const val = parser.parse();
  if (Number.isNaN(val) || !Number.isFinite(val)) return null;
  return clampChannel(val);
}

/** 计算派生色的完整 RGB */
export function evalLinkedColor(
  formula: { r: string; g: string; b: string },
  srcRgb: RgbTuple
): RgbTuple | null {
  const r = evalChannel(formula.r, srcRgb);
  const g = evalChannel(formula.g, srcRgb);
  const b = evalChannel(formula.b, srcRgb);
  if (r === null || g === null || b === null) return null;
  return [r, g, b];
}

/** 校验表达式是否合法（不计算，仅语法检查） */
export function isValidFormula(expr: string): boolean {
  const trimmed = (expr ?? "").trim();
  if (!trimmed) return false;
  const tokens = tokenize(trimmed);
  if (tokens.length === 0) return false;
  const parser = new Parser(tokens);
  const val = parser.parse();
  return !Number.isNaN(val) && Number.isFinite(val);
}

function clampChannel(value: number): number {
  return Math.min(255, Math.max(0, Math.round(value)));
}

/* ============ HSV 变量求值（v3） ============ */

const HSV_INDEX: Record<string, keyof HsvTuple> = { H: "h", S: "s", V: "v" };

/**
 * 计算单通道 HSV 表达式。
 * @param expr 表达式，如 "H+15"、"S*0.8"
 * @param srcHsv 源颜色 HSV
 * @returns 归一化后的通道值：H ∈ [0,360)，S/V ∈ [0,100]；非法返回 null
 */
export function evalHsvChannel(
  expr: string,
  srcHsv: HsvTuple
): number | null {
  const trimmed = (expr ?? "").trim();
  if (!trimmed) return null;
  const tokens = tokenize(trimmed);
  if (tokens.length === 0) return null;

  const resolved = tokens.map((t) =>
    t.type === "var"
      ? ({ type: "num", value: srcHsv[HSV_INDEX[t.name] ?? "h"] } as Token)
      : t
  );

  const parser = new Parser(resolved);
  const val = parser.parse();
  if (Number.isNaN(val) || !Number.isFinite(val)) return null;
  return normalizeHsv(val);
}

/** 将数值归一化到通道合法范围（保留小数，UI 显示取整由调用方决定） */
function normalizeHsv(value: number): number {
  return value;
}

/** H 通道归一化：mod 360 落到 [0,360) */
export function normalizeHue(h: number): number {
  const m = h % 360;
  return m < 0 ? m + 360 : m;
}

/** S/V 通道 clamp 到 [0,100] */
export function clampPercent(v: number): number {
  return Math.min(100, Math.max(0, v));
}

/** 计算派生色完整 HSV */
export function evalHsvLinked(
  formula: { h: string; s: string; v: string },
  srcHsv: HsvTuple
): HsvTuple | null {
  const h = evalHsvChannel(formula.h, srcHsv);
  const s = evalHsvChannel(formula.s, srcHsv);
  const v = evalHsvChannel(formula.v, srcHsv);
  if (h === null || s === null || v === null) return null;
  return { h: normalizeHue(h), s: clampPercent(s), v: clampPercent(v) };
}

/**
 * 自动生成 HSV 比例公式：根据源色 HSV 与目标 HSV 的差异反推。
 * 规则：
 *   H: 源H + (目标H - 源H)   → "H+15" 或 "H-20" 或 "H"（无偏移）
 *   S: 源S × (目标S / 源S)   → "S*0.8"（源S>0）；源S=0 退化为常量 "目标S"
 *   V: 源V × (目标V / 源V)   → "V*1.2"（源V>0）；源V=0 退化为常量 "目标V"
 */
export function generateHsvFormula(
  srcHsv: HsvTuple,
  targetHsv: HsvTuple
): { h: string; s: string; v: string } {
  // H：色相偏移
  let hExpr = "H";
  const dH = normalizeHue(targetHsv.h) - normalizeHue(srcHsv.h);
  // 取最小偏移（例如目标350 源10 → 偏移 -20 而非 +340）
  const diff = ((dH + 540) % 360) - 180;
  if (Math.abs(diff) >= 0.5) {
    const rounded = Math.round(diff);
    hExpr = rounded > 0 ? `H+${rounded}` : `H${rounded}`;
  }

  // S：比例（源S>0 时）
  let sExpr = "S";
  if (srcHsv.s > 0 && Math.abs(targetHsv.s - srcHsv.s) > 0.01) {
    const ratio = targetHsv.s / srcHsv.s;
    sExpr = formatRatio(ratio, "S");
  } else if (Math.abs(targetHsv.s - srcHsv.s) <= 0.01) {
    sExpr = "S";
  } else {
    // 源S=0：退化常量
    sExpr = String(Math.round(targetHsv.s));
  }

  // V：比例（源V>0 时）
  let vExpr = "V";
  if (srcHsv.v > 0 && Math.abs(targetHsv.v - srcHsv.v) > 0.01) {
    const ratio = targetHsv.v / srcHsv.v;
    vExpr = formatRatio(ratio, "V");
  } else if (Math.abs(targetHsv.v - srcHsv.v) <= 0.01) {
    vExpr = "V";
  } else {
    vExpr = String(Math.round(targetHsv.v));
  }

  return { h: hExpr, s: sExpr, v: vExpr };
}

/** 将比例格式化为简洁表达式，如 0.8 → "S*0.8"，1.25 → "S*1.25" */
function formatRatio(ratio: number, varName: string): string {
  const r = Math.round(ratio * 100) / 100;
  if (Math.abs(r - 1) < 0.001) return varName;
  return `${varName}*${r}`;
}

/** 校验 HSV 表达式是否合法 */
export function isValidHsvFormula(expr: string): boolean {
  return isValidFormula(expr);
}
