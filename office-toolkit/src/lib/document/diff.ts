/**
 * 行级 diff：Hirschberg 分治 LCS。
 * 选它而非全量 DP（5000 行需 50MB 矩阵）或 Myers（两文档几乎完全不同时退化为 O(N*M)）；
 * 时间 O(N*M) 与全量 DP 同阶，空间 O(min(N,M))，行为可预测、无需设 D 上限。
 */

export const MAX_LINES = 5000;

export type DiffSideStatus = "same" | "removed" | "added" | "changed";

export interface DiffSide {
  /** 1 起始行号 */
  no: number;
  text: string;
  status: DiffSideStatus;
}

/** 并排渲染的最小单位：左右两侧成对（单侧为 null 表示该行只存在于另一侧） */
export interface DiffRow {
  type: "equal" | "changed";
  left: DiffSide | null;
  right: DiffSide | null;
}

export interface DiffStats { added: number; removed: number; changed: number; }

type Match = [number, number];

/**
 * 一行滚动 DP：a[aStart, aEnd) 与 b[bStart, bEnd) 的 LCS 长度表。
 * 返回数组第 j 项 = LCS(a[aStart..aEnd), b[bStart..bStart+j))。
 */
function lcsRowForward(
  a: string[], aStart: number, aEnd: number,
  b: string[], bStart: number, bEnd: number
): Uint32Array {
  const n = bEnd - bStart;
  const prev = new Uint32Array(n + 1);
  const curr = new Uint32Array(n + 1);
  for (let i = aStart; i < aEnd; i++) {
    curr.fill(0);
    const av = a[i];
    for (let j = 0; j < n; j++) {
      curr[j + 1] = av === b[bStart + j] ? prev[j] + 1 : Math.max(prev[j + 1], curr[j]);
    }
    prev.set(curr);
  }
  return prev;
}

/** 反向版本：第 j 项 = LCS(a[aMid..aEnd) 的后 j 行, b[bEnd-j..bEnd)) */
function lcsRowBackward(
  a: string[], aStart: number, aEnd: number,
  b: string[], bStart: number, bEnd: number
): Uint32Array {
  const n = bEnd - bStart;
  const prev = new Uint32Array(n + 1);
  const curr = new Uint32Array(n + 1);
  for (let i = aEnd - 1; i >= aStart; i--) {
    curr.fill(0);
    const av = a[i];
    for (let j = n - 1; j >= 0; j--) {
      curr[j] = av === b[bStart + j] ? prev[j + 1] + 1 : Math.max(prev[j], curr[j + 1]);
    }
    prev.set(curr);
  }
  return prev;
}

function diffRec(
  a: string[], aStart: number, aEnd: number,
  b: string[], bStart: number, bEnd: number,
  out: Match[]
): void {
  const aLen = aEnd - aStart;
  const bLen = bEnd - bStart;
  if (aLen === 0 || bLen === 0) return;
  if (aLen === 1) {
    const av = a[aStart];
    for (let j = bStart; j < bEnd; j++) {
      if (b[j] === av) { out.push([aStart, j]); return; }
    }
    return;
  }
  if (bLen === 1) {
    const bv = b[bStart];
    for (let i = aStart; i < aEnd; i++) {
      if (a[i] === bv) { out.push([i, bStart]); return; }
    }
    return;
  }
  const aMid = aStart + (aLen >> 1);
  const l1 = lcsRowForward(a, aStart, aMid, b, bStart, bEnd);
  const l2 = lcsRowBackward(a, aMid, aEnd, b, bStart, bEnd);
  const n = bEnd - bStart;
  let bestJ = 0;
  let bestSum = -1;
  for (let j = 0; j <= n; j++) {
    // l1[j] = LCS(左半 a, b 的前 j 行)；l2[j] = LCS(右半 a, b 的第 j 行到末尾)，分割点和最大
    const sum = l1[j] + l2[j];
    if (sum > bestSum) { bestSum = sum; bestJ = j; }
  }
  diffRec(a, aStart, aMid, b, bStart, bStart + bestJ, out);
  diffRec(a, aMid, aEnd, b, bStart + bestJ, bEnd, out);
}

/**
 * 计算两份文档的行级差异。
 * 连续的 removed/added 段按顺序配对为 changed（并排显示为黄色修改对），
 * 配不上的剩余一侧为纯删/纯增。
 */
export function diffLines(a: string[], b: string[]): DiffRow[] {
  const matches: Match[] = [];
  diffRec(a, 0, a.length, b, 0, b.length, matches);

  const rows: DiffRow[] = [];
  let i = 0;
  let j = 0;

  const pushChanged = (li: number | null, lt: string, ri: number | null, rt: string) => {
    rows.push({
      type: "changed",
      left: li == null ? null : { no: li + 1, text: lt, status: "changed" },
      right: ri == null ? null : { no: ri + 1, text: rt, status: "changed" },
    });
  };

  for (const [mi, mj] of matches) {
    while (i < mi && j < mj) { pushChanged(i, a[i], j, b[j]); i++; j++; }
    while (i < mi) {
      rows.push({ type: "changed", left: { no: i + 1, text: a[i], status: "removed" }, right: null });
      i++;
    }
    while (j < mj) {
      rows.push({ type: "changed", left: null, right: { no: j + 1, text: b[j], status: "added" } });
      j++;
    }
    rows.push({
      type: "equal",
      left: { no: i + 1, text: a[i], status: "same" },
      right: { no: j + 1, text: b[j], status: "same" },
    });
    i++;
    j++;
  }
  // 尾部：matched 用尽后剩余的部分
  while (i < a.length && j < b.length) { pushChanged(i, a[i], j, b[j]); i++; j++; }
  while (i < a.length) {
    rows.push({ type: "changed", left: { no: i + 1, text: a[i], status: "removed" }, right: null });
    i++;
  }
  while (j < b.length) {
    rows.push({ type: "changed", left: null, right: { no: j + 1, text: b[j], status: "added" } });
    j++;
  }
  return rows;
}

/** 汇总差异统计 */
export function diffStats(rows: DiffRow[]): DiffStats {
  const stats: DiffStats = { added: 0, removed: 0, changed: 0 };
  for (const row of rows) {
    if (row.type === "equal") continue;
    if (row.left && row.right) stats.changed++;
    else if (row.left) stats.removed++;
    else stats.added++;
  }
  return stats;
}
