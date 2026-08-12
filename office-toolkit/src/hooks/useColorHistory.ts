"use client";

import { useCallback, useEffect, useState } from "react";

const STORAGE_KEY = "picker_history";
const MAX_ITEMS = 40;

export type HistorySide = "left" | "right";

export interface ColorHistory {
  left: string[];
  right: string[];
}

const EMPTY_HISTORY: ColorHistory = { left: [], right: [] };

/**
 * 取色历史记录（区分左右区域，sessionStorage）。
 * - 刷新页面：历史保留
 * - 关闭标签页 / 浏览器：自动清空（sessionStorage 生命周期）
 */
export function useColorHistory() {
  const [history, setHistory] = useState<ColorHistory>(EMPTY_HISTORY);

  // 初始化：从 sessionStorage 读取（仅客户端）
  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as Partial<ColorHistory>;
        setHistory({
          left: Array.isArray(parsed.left)
            ? parsed.left.filter((x): x is string => typeof x === "string")
            : [],
          right: Array.isArray(parsed.right)
            ? parsed.right.filter((x): x is string => typeof x === "string")
            : [],
        });
      }
    } catch {
      /* 解析失败则视为空历史 */
    }
  }, []);

  // 历史变化时同步到 sessionStorage
  useEffect(() => {
    try {
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify(history));
    } catch {
      /* 存储不可用时静默（不影响主功能） */
    }
  }, [history]);

  /** 往指定区域追加一个颜色（去重，最新在前），最多保留 MAX_ITEMS 个 */
  const addColor = useCallback((side: HistorySide, hex: string) => {
    setHistory((prev) => {
      const list = prev[side];
      const filtered = list.filter((c) => c !== hex);
      return { ...prev, [side]: [hex, ...filtered].slice(0, MAX_ITEMS) };
    });
  }, []);

  /** 清空历史 */
  const clear = useCallback(() => {
    setHistory(EMPTY_HISTORY);
  }, []);

  return { history, addColor, clear };
}
