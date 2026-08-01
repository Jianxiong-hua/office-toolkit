"use client";

import { Eye } from "lucide-react";

interface PreviewButtonProps {
  blob: Blob;
  filename?: string;
  format?: "image" | "pdf" | "auto";
  className?: string;
}

/**
 * 通用预览按钮
 * - image: 在新窗口居中展示图片
 * - pdf: 在新窗口打开 PDF
 * - auto: 根据 blob MIME 类型自动选择
 */
export function PreviewButton({
  blob,
  filename,
  format = "auto",
  className = "inline-flex items-center gap-1 rounded-lg bg-blue-100 px-3 py-1.5 text-sm font-medium text-blue-700 hover:bg-blue-200 transition-colors",
}: PreviewButtonProps) {
  const handlePreview = () => {
    const url = URL.createObjectURL(blob);
    const resolvedFormat: "image" | "pdf" =
      format === "auto" ? (blob.type.startsWith("image/") ? "image" : "pdf") : format;

    if (resolvedFormat === "image") {
      const w = window.open("", "_blank");
      if (w) {
        w.document.write(`
          <!doctype html>
          <html lang="zh-CN">
            <head>
              <meta charset="utf-8" />
              <title>${filename ?? "预览"}</title>
              <style>
                html,body{margin:0;height:100%}
                body{background:#f3f4f6;display:flex;align-items:center;justify-content:center;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
                img{max-width:96%;max-height:96vh;box-shadow:0 4px 24px rgba(0,0,0,.15);background:white}
                .fallback{color:#6b7280;font-size:14px}
              </style>
            </head>
            <body>
              <img src="${url}" alt="${filename ?? ""}"/>
            </body>
          </html>
        `);
        w.document.close();
      }
    } else {
      window.open(url, "_blank");
    }

    // 给浏览器一些时间来加载再释放
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  };

  return (
    <button onClick={handlePreview} className={className} type="button">
      <Eye className="h-4 w-4" />
      预览
    </button>
  );
}
