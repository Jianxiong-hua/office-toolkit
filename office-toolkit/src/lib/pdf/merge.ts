import { PDFDocument } from "pdf-lib";
import { readFileAsArrayBuffer, readFileAsDataURL } from "@/lib/file";

export interface MergeOptions {
  /** 是否将上传的图片文件缩小到与 PDF 接近的 DPI */
  shrinkImageFiles?: boolean;
  /** 目标 DPI：仅在 shrinkImageFiles=true 时生效，固定 72 或 96 */
  targetDpi?: 72 | 96;
}

// 图片缩小相关参数
const A4_WIDTH_INCHES = 8.27; // A4 宽（英寸）：210 mm ÷ 25.4
const JPEG_QUALITY = 0.85; // JPEG 重编码质量

/**
 * 将图片缩小到与 A4 页面在指定 DPI 下等宽
 * - 目标宽度 = A4_WIDTH_INCHES × targetDpi
 *   - 72 DPI → 595 px
 *   - 96 DPI → 794 px
 * - 等比缩放，高度按比例计算
 * - 原图若已比目标宽度更窄，则按原尺寸嵌入（不放大）
 * - 保持原始格式：PNG → PNG（无损），JPEG → JPEG（q=0.85 重编码）
 *
 * 注意：该模式仅适合电子版查看，不适合打印（打印通常需要 300 DPI）。
 */
async function shrinkImage(
  file: File,
  targetDpi: 72 | 96
): Promise<{ bytes: Uint8Array; width: number; height: number; useJpg: boolean }> {
  const dataUrl = await readFileAsDataURL(file);
  const img = new Image();
  await new Promise<void>((resolve, reject) => {
    img.onload = () => resolve();
    img.onerror = () => reject(new Error(`图片加载失败：${file.name}`));
    img.src = dataUrl;
  });

  const origW = img.width;
  const origH = img.height;
  const targetWidth = Math.round(A4_WIDTH_INCHES * targetDpi);

  // 等比例缩放：若原图已比目标宽度更窄，保持原尺寸（不放大）
  let targetW = origW;
  let targetH = origH;
  if (origW > targetWidth) {
    targetW = targetWidth;
    targetH = Math.round((origH * targetWidth) / origW);
  }

  // 绘制到 canvas（不填充背景，保留透明区域）
  const canvas = document.createElement("canvas");
  canvas.width = targetW;
  canvas.height = targetH;
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  ctx.drawImage(img, 0, 0, targetW, targetH);

  // 保持原始格式：避免对噪声类 PNG 错误地转 JPEG 反而变大
  const isPng =
    file.type === "image/png" || file.name.toLowerCase().endsWith(".png");
  const useJpg = !isPng;
  const mimeType = isPng ? "image/png" : "image/jpeg";

  const blob: Blob = await new Promise((resolve, reject) => {
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error("canvas.toBlob failed"))),
      mimeType,
      isPng ? undefined : JPEG_QUALITY
    );
  });

  return {
    bytes: new Uint8Array(await blob.arrayBuffer()),
    width: targetW,
    height: targetH,
    useJpg,
  };
}

/**
 * 把上传的图片文件按原始尺寸嵌入到新页（不做任何压缩）
 */
async function embedImageAsIs(
  mergedPdf: PDFDocument,
  file: File
): Promise<{ img: any; width: number; height: number }> {
  const dataUrl = await readFileAsDataURL(file);
  const imageBytes = await fetch(dataUrl).then((res) => res.arrayBuffer());
  const ext = file.name.split(".").pop()?.toLowerCase();

  if (ext === "png") {
    const img = await mergedPdf.embedPng(imageBytes);
    return { img, width: img.width, height: img.height };
  }
  if (ext === "jpg" || ext === "jpeg") {
    const img = await mergedPdf.embedJpg(imageBytes);
    return { img, width: img.width, height: img.height };
  }

  // WebP / GIF 等其他格式：先通过 canvas 解码再以 PNG 嵌入
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d")!;
  const imgEl = new Image();
  await new Promise<void>((resolve, reject) => {
    imgEl.onload = () => resolve();
    imgEl.onerror = () => reject(new Error(`图片加载失败：${file.name}`));
    imgEl.src = dataUrl;
  });
  canvas.width = imgEl.width;
  canvas.height = imgEl.height;
  ctx.drawImage(imgEl, 0, 0);
  const pngBlob = await new Promise<Blob>((resolve) => {
    canvas.toBlob((b) => resolve(b!), "image/png");
  });
  const pngBuffer = await pngBlob.arrayBuffer();
  const img = await mergedPdf.embedPng(pngBuffer);
  return { img, width: img.width, height: img.height };
}

/**
 * 合并多个 PDF 文件为一个
 * @param pdfFiles PDF 文件 ArrayBuffer 数组
 * @returns 合并后的 PDF 字节
 */
export async function mergePDFs(pdfFiles: ArrayBuffer[]): Promise<Uint8Array> {
  const mergedPdf = await PDFDocument.create();

  for (const pdfBytes of pdfFiles) {
    const pdf = await PDFDocument.load(pdfBytes, {
      ignoreEncryption: true,
    });
    const copiedPages = await mergedPdf.copyPages(pdf, pdf.getPageIndices());
    copiedPages.forEach((page) => mergedPdf.addPage(page));
  }

  return mergedPdf.save();
}

/**
 * 合并混合文件（PDF + 图片）
 *
 * 行为约定：
 * - PDF 文件：原样复制所有页面，不做任何压缩或重渲染
 * - 图片文件：
 *   - shrinkImageFiles=false → 按原始尺寸嵌入
 *   - shrinkImageFiles=true → 缩小到 A4 宽 × targetDpi（72 或 96）
 *
 * @param files 文件数组（含 File 对象和类型标记）
 * @param options 合并选项
 * @returns 合并后的 PDF 字节
 */
export async function mergeMixedFiles(
  files: Array<{ file: File; type: "pdf" | "image" }>,
  options: MergeOptions = {}
): Promise<Uint8Array> {
  const { shrinkImageFiles = false, targetDpi = 96 } = options;
  const mergedPdf = await PDFDocument.create();

  for (const { file, type } of files) {
    if (type === "pdf") {
      // PDF 文件：完全保留原始内容，不做任何处理
      const buffer = await readFileAsArrayBuffer(file);
      const pdf = await PDFDocument.load(buffer, { ignoreEncryption: true });
      const copiedPages = await mergedPdf.copyPages(pdf, pdf.getPageIndices());
      copiedPages.forEach((page) => mergedPdf.addPage(page));
      continue;
    }

    // 图片文件
    let embeddedImage: any;
    let imgW: number;
    let imgH: number;

    if (shrinkImageFiles) {
      // 缩小到 A4 宽 × targetDpi 等宽
      const shrunk = await shrinkImage(file, targetDpi);
      imgW = shrunk.width;
      imgH = shrunk.height;
      embeddedImage = shrunk.useJpg
        ? await mergedPdf.embedJpg(shrunk.bytes)
        : await mergedPdf.embedPng(shrunk.bytes);
    } else {
      // 原始尺寸直接嵌入
      const embedded = await embedImageAsIs(mergedPdf, file);
      embeddedImage = embedded.img;
      imgW = embedded.width;
      imgH = embedded.height;
    }

    // 创建与图片尺寸相同的页面（PDF 中 1 point = 1/72 inch，图片以约 72 DPI 显示）
    const page = mergedPdf.addPage([imgW, imgH]);
    page.drawImage(embeddedImage, {
      x: 0,
      y: 0,
      width: imgW,
      height: imgH,
    });
  }

  return mergedPdf.save();
}

/**
 * 合并指定页面范围的 PDF
 * @param pdfFiles PDF 文件数据（含可选页码范围）
 */
export async function mergePDFsWithRanges(
  inputs: Array<{
    buffer: ArrayBuffer;
    pageRange?: { start: number; end: number }; // 1-based, inclusive
  }>
): Promise<Uint8Array> {
  const mergedPdf = await PDFDocument.create();

  for (const input of inputs) {
    const pdf = await PDFDocument.load(input.buffer, {
      ignoreEncryption: true,
    });
    const totalPages = pdf.getPageCount();

    let start = 0;
    let end = totalPages;

    if (input.pageRange) {
      start = Math.max(0, input.pageRange.start - 1);
      end = Math.min(totalPages, input.pageRange.end);
    }

    const pageIndices = Array.from({ length: end - start }, (_, i) => start + i);
    const copiedPages = await mergedPdf.copyPages(pdf, pageIndices);
    copiedPages.forEach((page) => mergedPdf.addPage(page));
  }

  return mergedPdf.save();
}

/**
 * 获取 PDF 页数
 */
export async function getPDFPageCount(buffer: ArrayBuffer): Promise<number> {
  const pdf = await PDFDocument.load(buffer, { ignoreEncryption: true });
  return pdf.getPageCount();
}
