import { PDFDocument } from "pdf-lib";
import { readFileAsArrayBuffer, readFileAsDataURL } from "@/lib/file";

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
 * @param files 文件数组，包含 File 对象和类型标记
 * @returns 合并后的 PDF 字节
 */
export async function mergeMixedFiles(
  files: Array<{ file: File; type: "pdf" | "image" }>
): Promise<Uint8Array> {
  const mergedPdf = await PDFDocument.create();

  for (const { file, type } of files) {
    if (type === "pdf") {
      // PDF 文件：直接复制页面
      const buffer = await readFileAsArrayBuffer(file);
      const pdf = await PDFDocument.load(buffer, {
        ignoreEncryption: true,
      });
      const copiedPages = await mergedPdf.copyPages(pdf, pdf.getPageIndices());
      copiedPages.forEach((page) => mergedPdf.addPage(page));
    } else {
      // 图片文件：嵌入为单页 PDF
      const dataUrl = await readFileAsDataURL(file);
      const imageBytes = await fetch(dataUrl).then((res) => res.arrayBuffer());
      
      let embeddedImage;
      const ext = file.name.split(".").pop()?.toLowerCase();
      if (ext === "png") {
        embeddedImage = await mergedPdf.embedPng(imageBytes);
      } else if (ext === "jpg" || ext === "jpeg") {
        embeddedImage = await mergedPdf.embedJpg(imageBytes);
      } else {
        // WebP 等其他格式：先转换为 PNG
        const canvas = document.createElement("canvas");
        const ctx = canvas.getContext("2d")!;
        const img = new Image();
        await new Promise((resolve, reject) => {
          img.onload = resolve;
          img.onerror = reject;
          img.src = dataUrl;
        });
        canvas.width = img.width;
        canvas.height = img.height;
        ctx.drawImage(img, 0, 0);
        const pngBlob = await new Promise<Blob>((resolve) => {
          canvas.toBlob((b) => resolve(b!), "image/png");
        });
        const pngBuffer = await pngBlob.arrayBuffer();
        embeddedImage = await mergedPdf.embedPng(pngBuffer);
      }

      // 创建与图片尺寸相同的页面
      const page = mergedPdf.addPage([embeddedImage.width, embeddedImage.height]);
      page.drawImage(embeddedImage, {
        x: 0,
        y: 0,
        width: embeddedImage.width,
        height: embeddedImage.height,
      });
    }
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
