"use client";

import { AlertCircle, X } from "lucide-react";
import { errorMessages, type AppErrorCode } from "@/types";

interface ErrorAlertProps {
  code?: AppErrorCode;
  message?: string;
  details?: string;
  onRetry?: () => void;
  onClose?: () => void;
}

export function ErrorAlert({
  code,
  message,
  details,
  onRetry,
  onClose,
}: ErrorAlertProps) {
  const displayMessage = message || (code ? errorMessages[code] : "发生错误");

  return (
    <div className="rounded-xl border border-red-200 bg-red-50 p-4 animate-fade-in">
      <div className="flex items-start gap-3">
        <AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-red-600" />
        <div className="flex-1">
          <h4 className="font-medium text-red-800">处理失败</h4>
          <p className="mt-1 text-sm text-red-700">{displayMessage}</p>
          {details && (
            <p className="mt-1 text-xs text-red-600/70">{details}</p>
          )}
          {onRetry && (
            <button
              onClick={onRetry}
              className="mt-3 rounded-lg bg-red-100 px-3 py-1.5 text-sm font-medium text-red-700 hover:bg-red-200 transition-colors"
            >
              重试
            </button>
          )}
        </div>
        {onClose && (
          <button
            onClick={onClose}
            className="flex h-6 w-6 items-center justify-center rounded-md text-red-400 hover:bg-red-100 hover:text-red-600 transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>
    </div>
  );
}
