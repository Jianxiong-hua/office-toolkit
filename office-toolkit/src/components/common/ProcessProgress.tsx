"use client";

import { Loader2 } from "lucide-react";

interface ProcessProgressProps {
  message?: string;
  progress?: number;
  onCancel?: () => void;
}

export function ProcessProgress({
  message = "处理中...",
  progress,
  onCancel,
}: ProcessProgressProps) {
  return (
    <div className="rounded-2xl border border-brand-100 bg-brand-50 p-6 animate-fade-in">
      <div className="flex items-center gap-3 mb-3">
        <Loader2 className="h-5 w-5 animate-spin text-brand-600" />
        <span className="font-medium text-brand-800">{message}</span>
      </div>
      {progress !== undefined && (
        <div className="h-2 w-full overflow-hidden rounded-full bg-brand-100">
          <div
            className="h-full rounded-full bg-brand-600 transition-all duration-300"
            style={{ width: `${Math.min(100, Math.max(0, progress))}%` }}
          />
        </div>
      )}
      {onCancel && (
        <button
          onClick={onCancel}
          className="mt-4 text-sm text-brand-600 hover:text-brand-700 hover:underline"
        >
          取消处理
        </button>
      )}
    </div>
  );
}
