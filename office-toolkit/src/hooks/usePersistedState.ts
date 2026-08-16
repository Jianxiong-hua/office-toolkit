"use client";

import { useCallback, useEffect, useState } from "react";

/**
 * 将 state 持久化到 localStorage 的 hook。
 * - 初始从 localStorage 读取（若无则用 initialValue）
 * - state 变化时写回
 */
export function usePersistedState<T>(
  key: string,
  initialValue: T,
  validate?: (value: unknown) => value is T
): [T, React.Dispatch<React.SetStateAction<T>>] {
  const [state, setState] = useState<T>(() => {
    if (typeof window === "undefined") return initialValue;
    try {
      const raw = localStorage.getItem(key);
      if (!raw) return initialValue;
      const parsed = JSON.parse(raw) as unknown;
      if (validate && !validate(parsed)) return initialValue;
      return parsed as T;
    } catch {
      return initialValue;
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem(key, JSON.stringify(state));
    } catch {
      /* 存储不可用时静默 */
    }
  }, [key, state]);

  return [state, setState];
}
