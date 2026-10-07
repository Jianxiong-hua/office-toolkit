/** 字节搜索：查询解析与命中查找（纯函数） */

/**
 * 命中列表最多保留的条数。
 * 20MB 文件里搜索 `00` 可能命中数十万处，全量渲染会拖垮页面，
 * 因此只统计总数、只列出前若干条，靠「上一处 / 下一处」在结果间跳转。
 */
export const MAX_LISTED_HITS = 200;

export interface ParsedQuery {
  bytes: number[];
  mode: "hex" | "ascii";
}

/**
 * 解析搜索输入，自动判别字节串模式。
 *
 * 自动判别规则（按顺序）：
 * 1. 输入以 `h:` / `hex:` 开头 → 强制 hex 字节串
 * 2. 输入以 `t:` / `text:` 开头 → 强制文本
 * 3. 含空格或逗号且是合法偶数长度 hex 串 → hex（`FF 00`、`10 24`）
 * 4. compact 全为数字 → 文本（`1024` 搜文本比搜字节串更常见）
 * 5. 其余合法偶数长度 hex 串 → hex（`ff00`、`deadbeef`）
 * 6. 其余 → 文本（`hello`）
 *
 * 存在无法自动消除的歧义：`cafe` 既可能是文本、也可能是字节串 CA FE。
 * 因此提供 `h:` / `t:` 前缀显式指定，不靠猜。
 *
 * 注意：hex 模式是**精确字节匹配**，因此**区分大小写**。
 */
export function parseQuery(input: string): ParsedQuery | null {
  const original = input.trim();
  if (!original) return null;

  let s = original;
  let forced: "hex" | "ascii" | null = null;
  const lower = s.toLowerCase();
  if (lower.startsWith("hex:")) {
    forced = "hex";
    s = s.slice(4);
  } else if (lower.startsWith("text:")) {
    forced = "ascii";
    s = s.slice(5);
  } else if (lower.startsWith("h:")) {
    forced = "hex";
    s = s.slice(2);
  } else if (lower.startsWith("t:")) {
    forced = "ascii";
    s = s.slice(2);
  }

  const hasSeparator = /[\s,]/.test(s);
  const compact = s.replace(/[\s,]+/g, "");
  if (!compact) return null;

  const isHexChars = /^[0-9a-fA-F]+$/.test(compact);
  const isEvenLength = compact.length % 2 === 0;
  const isAllDigits = /^[0-9]+$/.test(compact);

  const useHex =
    forced === "hex" ||
    (forced !== "ascii" &&
      isHexChars &&
      isEvenLength &&
      (hasSeparator || (!isAllDigits && /[a-fA-F]/.test(compact))));

  if (useHex) {
    const bytes: number[] = [];
    for (let i = 0; i < compact.length; i += 2) {
      bytes.push(parseInt(compact.slice(i, i + 2), 16));
    }
    return { bytes, mode: "hex" };
  }

  const bytes = Array.from(new TextEncoder().encode(s));
  return bytes.length > 0 ? { bytes, mode: "ascii" } : null;
}

export interface SearchHits {
  /** 命中总数（可能远大于 offsets.length） */
  total: number;
  /** 命中位置，最多 MAX_LISTED_HITS 条 */
  offsets: number[];
  /** 是否因为超过上限而被截断 */
  truncated: boolean;
}

/** 查找 pattern 在 bytes 中出现的所有位置（精确字节匹配） */
export function findHits(bytes: Uint8Array, pattern: number[]): SearchHits {
  if (pattern.length === 0 || pattern.length > bytes.length) {
    return { total: 0, offsets: [], truncated: false };
  }

  const offsets: number[] = [];
  let total = 0;
  const first = pattern[0];
  const last = bytes.length - pattern.length;
  for (let i = 0; i <= last; i++) {
    // 预筛选首字节，绝大多数位置只需一次比较
    if (bytes[i] !== first) continue;
    let matched = true;
    for (let j = 1; j < pattern.length; j++) {
      if (bytes[i + j] !== pattern[j]) {
        matched = false;
        break;
      }
    }
    if (matched) {
      total++;
      if (offsets.length < MAX_LISTED_HITS) offsets.push(i);
    }
  }

  return { total, offsets, truncated: total > MAX_LISTED_HITS };
}
