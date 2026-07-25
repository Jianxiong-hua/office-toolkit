"use client";

import { Download, Loader2 } from "lucide-react";

interface DownloadButtonProps {
  onClick: () => void;
  loading?: boolean;
  disabled?: boolean;
  label?: string;
}

export function DownloadButton({
  onClick,
  loading = false,
  disabled = false,
  label = "下载",
}: DownloadButtonProps) {
  return (
    <button
      onClick={onClick}
      disabled={disabled || loading}
      className="inline-flex items-center gap-2 rounded-xl bg-brand-600 px-6 py-3 text-white font-medium hover:bg-brand-700 disabled:opacity-50 disabled:cursor-not-allowed transition-all shadow-lg shadow-brand-200"
    >
      {loading ? (
        <Loader2 className="h-5 w-5 animate-spin" />
      ) : (
        <Download className="h-5 w-5" />
      )}
      {loading ? "处理中..." : label}
    </button>
  );
}
