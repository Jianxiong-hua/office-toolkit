import { PDFDocument, PDFImage, PDFPage, rgb, StandardFonts, degrees } from "pdf-lib";
import { readFileAsArrayBuffer } from "@/lib/file";
import { AppError } from "@/types";

export type WatermarkPosition =
  | "center"
  | "topleft"
  | "topright"
  | "bottomleft"
  | "bottomright"
  | "tile";

export interface TextWatermarkOptions {
  type: "text";
  text: string;
  fontSize: number;
  color: string; // hex like #ff0000
  opacity: number; // 0-1
  rotation: number; // degrees
  position: WatermarkPosition;
}

export interface ImageWatermarkOptions {
  type: "image";
  imageFile: File;
  width: number; // points
  opacity: number; // 0-1
  rotation: number; // degrees
  position: WatermarkPosition;
}

export type WatermarkOptions = TextWatermarkOptions | ImageWatermarkOptions;

function hexToRgb(hex: string) {
  const clean = hex.replace("#", "");
  const bigint = parseInt(clean, 16);
  const r = ((bigint >> 16) & 255) / 255;
  const g = ((bigint >> 8) & 255) / 255;
  const b = (bigint & 255) / 255;
  return { r, g, b };
}

function getPosition(
  page: PDFPage,
  contentWidth: number,
  contentHeight: number,
  position: WatermarkPosition
): { x: number; y: number }[] {
  const { width: pageWidth, height: pageHeight } = page.getSize();
  const marginX = 40;
  const marginY = 40;

  switch (position) {
    case "center":
      return [
        {
          x: (pageWidth - contentWidth) / 2,
          y: (pageHeight - contentHeight) / 2,
        },
      ];
    case "topleft":
      return [{ x: marginX, y: pageHeight - contentHeight - marginY }];
    case "topright":
      return [{ x: pageWidth - contentWidth - marginX, y: pageHeight - contentHeight - marginY }];
    case "bottomleft":
      return [{ x: marginX, y: marginY }];
    case "bottomright":
      return [{ x: pageWidth - contentWidth - marginX, y: marginY }];
    case "tile": {
      const positions: { x: number; y: number }[] = [];
      const spacingX = contentWidth + 80;
      const spacingY = contentHeight + 80;
      for (let x = marginX; x + contentWidth < pageWidth; x += spacingX) {
        for (let y = marginY; y + contentHeight < pageHeight; y += spacingY) {
          positions.push({ x, y });
        }
      }
      return positions;
    }
    default:
      return [
        {
          x: (pageWidth - contentWidth) / 2,
          y: (pageHeight - contentHeight) / 2,
        },
      ];
  }
}

/**
 * 为 PDF 添加水印
 */
export async function addWatermark(
  pdfBuffer: ArrayBuffer,
  options: WatermarkOptions
): Promise<Uint8Array> {
  const pdf = await PDFDocument.load(pdfBuffer, { ignoreEncryption: true });
  const pages = pdf.getPages();

  if (options.type === "text") {
    if (!options.text.trim()) {
      throw new AppError("INVALID_INPUT", "水印文字不能为空");
    }
    const font = await pdf.embedFont(StandardFonts.Helvetica);
    const color = hexToRgb(options.color);

    for (const page of pages) {
      const textWidth = font.widthOfTextAtSize(options.text, options.fontSize);
      const textHeight = options.fontSize;
      const positions = getPosition(page, textWidth, textHeight, options.position);

      for (const { x, y } of positions) {
        page.drawText(options.text, {
          x,
          y,
          size: options.fontSize,
          font,
          color: rgb(color.r, color.g, color.b),
          opacity: options.opacity,
          rotate: degrees(options.rotation),
        });
      }
    }
  } else {
    const imageBytes = await readFileAsArrayBuffer(options.imageFile);
    let pdfImage: PDFImage;

    const ext = options.imageFile.name.split(".").pop()?.toLowerCase();
    if (ext === "png") {
      pdfImage = await pdf.embedPng(imageBytes);
    } else if (ext === "jpg" || ext === "jpeg") {
      pdfImage = await pdf.embedJpg(imageBytes);
    } else {
      throw new AppError("UNSUPPORTED_FORMAT", "水印图片仅支持 PNG 和 JPG 格式");
    }

    const originalSize = pdfImage.size();
    const aspectRatio = originalSize.width / originalSize.height;
    const width = options.width;
    const height = width / aspectRatio;

    for (const page of pages) {
      const positions = getPosition(page, width, height, options.position);
      for (const { x, y } of positions) {
        page.drawImage(pdfImage, {
          x,
          y,
          width,
          height,
          opacity: options.opacity,
          rotate: degrees(options.rotation),
        });
      }
    }
  }

  return pdf.save();
}
