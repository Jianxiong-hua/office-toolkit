import { PDFDocument } from "pdf-lib";
import { AppError } from "@/types";

export interface SplitRange {
  start: number; // 1-based, inclusive
  end: number; // 1-based, inclusive
}

/**
 * 获取 PDF 总页数
 */
export async function getPDFPageCount(buffer: ArrayBuffer): Promise<number> {
  try {
    const pdf = await PDFDocument.load(buffer, { ignoreEncryption: true });
    return pdf.getPageCount();
  } catch (err) {
    throw new AppError(
      "PROCESS_FAILED",
      "无法读取 PDF 页数",
      err instanceof Error ? err.message : undefined
    );
  }
}

/**
 * 解析页码范围字符串
 * 支持格式：1-3, 5, 8-10
 */
export function parsePageRanges(input: string, totalPages: number): SplitRange[] {
  const ranges: SplitRange[] = [];
  const parts = input.split(",").map((p) => p.trim());

  for (const part of parts) {
    if (!part) continue;

    if (part.includes("-")) {
      const [startStr, endStr] = part.split("-");
      const start = parseInt(startStr.trim(), 10);
      const end = parseInt(endStr.trim(), 10);

      if (isNaN(start) || isNaN(end) || start < 1 || end > totalPages || start > end) {
        throw new AppError(
          "INVALID_INPUT",
          `页码范围 "${part}" 无效，请输入 1-${totalPages} 之间的范围`
        );
      }
      ranges.push({ start, end });
    } else {
      const page = parseInt(part, 10);
      if (isNaN(page) || page < 1 || page > totalPages) {
        throw new AppError(
          "INVALID_INPUT",
          `页码 "${part}" 无效，请输入 1-${totalPages} 之间的数字`
        );
      }
      ranges.push({ start: page, end: page });
    }
  }

  if (ranges.length === 0) {
    throw new AppError("INVALID_INPUT", "请输入有效的页码范围");
  }

  return ranges;
}

/**
 * 按页码范围拆分 PDF
 */
export async function splitPDFByRanges(
  buffer: ArrayBuffer,
  ranges: SplitRange[]
): Promise<{ bytes: Uint8Array; range: SplitRange }[]> {
  const sourcePdf = await PDFDocument.load(buffer, { ignoreEncryption: true });
  const results: { bytes: Uint8Array; range: SplitRange }[] = [];

  for (const range of ranges) {
    const newPdf = await PDFDocument.create();
    const startIndex = range.start - 1;
    const endIndex = range.end;
    const pageIndices = Array.from(
      { length: endIndex - startIndex },
      (_, i) => startIndex + i
    );
    const copiedPages = await newPdf.copyPages(sourcePdf, pageIndices);
    copiedPages.forEach((page) => newPdf.addPage(page));

    results.push({
      bytes: await newPdf.save(),
      range,
    });
  }

  return results;
}

/**
 * 按每 N 页拆分 PDF
 */
export async function splitPDFByInterval(
  buffer: ArrayBuffer,
  interval: number
): Promise<{ bytes: Uint8Array; range: SplitRange }[]> {
  const totalPages = await getPDFPageCount(buffer);
  if (interval < 1 || interval > totalPages) {
    throw new AppError(
      "INVALID_INPUT",
      `每页数必须在 1-${totalPages} 之间`
    );
  }

  const ranges: SplitRange[] = [];
  for (let start = 1; start <= totalPages; start += interval) {
    const end = Math.min(totalPages, start + interval - 1);
    ranges.push({ start, end });
  }

  return splitPDFByRanges(buffer, ranges);
}

/**
 * 提取单页
 */
export async function extractPDFPages(
  buffer: ArrayBuffer
): Promise<{ bytes: Uint8Array; range: SplitRange }[]> {
  const totalPages = await getPDFPageCount(buffer);
  const ranges: SplitRange[] = Array.from({ length: totalPages }, (_, i) => ({
    start: i + 1,
    end: i + 1,
  }));
  return splitPDFByRanges(buffer, ranges);
}

/**
 * 把 PDF 每一页渲染为 PNG 图片
 * 使用 pdfjs-dist 在浏览器中渲染
 * 禁用 Worker 避免 Next.js 静态导出/开发环境下的 worker 路径问题
 */
export async function extractPDFPagesAsPng(
  buffer: ArrayBuffer,
  scale: number = 2
): Promise<{ bytes: Uint8Array; range: SplitRange }[]> {
  // 动态导入避免 SSR 问题
  const pdfjsLib = await import("pdfjs-dist");
  // pdfjs 6.x 在浏览器要求 workerSrc 非空，但可以通过预先把 WorkerMessageHandler
  // 挂到 globalThis.pdfjsWorker 来走"主线程 worker"分支，绕过真实 worker 加载
  pdfjsLib.GlobalWorkerOptions.workerSrc = "";
  if (!(globalThis as any).pdfjsWorker) {
    const workerModule: any = await import(
      "pdfjs-dist/build/pdf.worker.min.mjs"
    );
    (globalThis as any).pdfjsWorker = {
      WorkerMessageHandler: workerModule.WorkerMessageHandler,
    };
  }

  const data = new Uint8Array(buffer);
  const loadingTask = pdfjsLib.getDocument({ data });
  const pdf = await loadingTask.promise;
  const totalPages = pdf.numPages;
  const results: { bytes: Uint8Array; range: SplitRange }[] = [];

  for (let pageNum = 1; pageNum <= totalPages; pageNum++) {
    const page = await pdf.getPage(pageNum);
    const viewport = page.getViewport({ scale });

    const canvas = document.createElement("canvas");
    canvas.width = Math.floor(viewport.width);
    canvas.height = Math.floor(viewport.height);
    const ctx = canvas.getContext("2d")!;
    await page.render({ canvasContext: ctx, viewport, canvas }).promise;

    const blob: Blob = await new Promise((resolve, reject) => {
      canvas.toBlob((b) => {
        if (b) resolve(b);
        else reject(new Error("canvas.toBlob failed"));
      }, "image/png");
    });
    const bytes = new Uint8Array(await blob.arrayBuffer());

    results.push({
      bytes,
      range: { start: pageNum, end: pageNum },
    });
  }

  // pdfjs-dist 没有 destroy 方法，仅清空引用让 GC 回收
  return results;
}
