/**
 * 文档文本提取与编码处理（纯函数 + 浏览器 API）。
 *
 * 已知局限（需求文档第 5 节）：docx 仅读取 word/document.xml 正文，
 * 丢失全部格式（标题/加粗/列表符号/表格列对应/图片/脚注/批注/页眉页脚/修订）。
 */

export const SUPPORTED_EXT = ["docx", "txt", "md"] as const;
export type DocEncoding = "utf-8" | "gbk" | "big5";
export const ENCODING_OPTIONS: DocEncoding[] = ["utf-8", "gbk", "big5"];
export const ENCODING_LABELS: Record<DocEncoding, string> = {
  "utf-8": "UTF-8",
  gbk: "GBK",
  big5: "Big5",
};

/** 按指定编码解码字节 */
export function decodeText(buffer: ArrayBuffer, encoding: DocEncoding): string {
  return new TextDecoder(encoding).decode(buffer);
}

/**
 * UTF-8 解码出现替换字符（U+FFFD）说明字节流不是有效 UTF-8——
 * 中文场景最常见原因是 GBK 编码，调用方应回退 GBK 重解。
 */
export function needsGbkFallback(text: string): boolean {
  return text.includes(String.fromCharCode(0xFFFD));
}

/** 去首尾空白行，保留中间空行（空行是差异信号） */
export function trimBlankLines(lines: string[]): string[] {
  let start = 0;
  let end = lines.length;
  while (start < end && lines[start].trim() === "") start++;
  while (end > start && lines[end - 1].trim() === "") end--;
  return lines.slice(start, end);
}

/** txt / md 通用：统一 CR-LF 与 CR 为 LF 后分割（避免正则中的转义序列） */ const CHAR_CR = String.fromCharCode(13); const CHAR_LF = String.fromCharCode(10);  export function extractPlainText(text: string): string[] {   const unified = text.split(CHAR_CR + CHAR_LF).join(CHAR_LF).split(CHAR_CR).join(CHAR_LF);   return trimBlankLines(unified.split(CHAR_LF)); }  export async function extractDocx(buffer: ArrayBuffer): Promise<string[]> {
  const JSZip = (await import("jszip")).default;
  const zip = await JSZip.loadAsync(buffer);
  const entry = zip.file("word/document.xml");
  if (!entry) throw new Error("不是有效的 docx 文件（缺少 word/document.xml）");
  const xml = await entry.async("string");
  const doc = new DOMParser().parseFromString(xml, "application/xml");
  if (doc.getElementsByTagName("parsererror").length > 0) {
    throw new Error("文档内容解析失败，文件可能已损坏");
  }
  const paragraphs = doc.getElementsByTagName("w:p");
  const lines: string[] = [];
  for (let i = 0; i < paragraphs.length; i++) {
    const texts = paragraphs[i].getElementsByTagName("w:t");
    let line = "";
    for (let k = 0; k < texts.length; k++) line += texts[k].textContent ?? "";
    lines.push(line);
  }
  return trimBlankLines(lines);
}
