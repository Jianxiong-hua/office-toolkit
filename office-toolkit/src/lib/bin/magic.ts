/** 文件类型识别：扩展名优先，未命中再用魔数（纯函数） */
import { getFileExtension } from "@/lib/file";

export type FormatSource = "extension" | "magic" | "unknown";

export interface FormatInfo {
  name: string;
  source: FormatSource;
  /** 扩展名与魔数都命中但指向不同类型时为 true（最有价值的诊断信号） */
  mismatch: boolean;
  /** 魔数识别到的类型，未命中为 null；mismatch 提示需要它 */
  magicName: string | null;
}

/** 「原始二进制」——无结构、纯字节流 */
const RAW_BINARY = "原始二进制";

/**
 * 扩展名 → 类型名。
 * 取值刻意与 MAGIC_RULES 中的 name 保持同一套字符串，
 * 这样两者都命中时才能直接比对出 mismatch。
 */
const EXTENSION_MAP: Record<string, string> = {
  bin: RAW_BINARY,
  raw: RAW_BINARY,
  dat: RAW_BINARY,
  dump: RAW_BINARY,
  hex: RAW_BINARY,
  img: RAW_BINARY,
  png: "PNG 图像",
  jpg: "JPEG 图像",
  jpeg: "JPEG 图像",
  gif: "GIF 图像",
  bmp: "BMP 图像",
  webp: "WebP 图像",
  ico: "ICO 图标",
  svg: "SVG 图像",
  psd: "Photoshop 图像",
  pdf: "PDF 文档",
  docx: "Word 文档",
  xlsx: "Excel 表格",
  pptx: "PowerPoint 演示",
  zip: "ZIP 压缩包",
  gz: "GZIP 压缩",
  tgz: "GZIP 压缩",
  bz2: "BZIP2 压缩",
  xz: "XZ 压缩",
  "7z": "7-Zip 压缩",
  rar: "RAR 压缩",
  exe: "Windows 可执行文件",
  dll: "Windows 动态库",
  msi: "Windows 安装包",
  elf: "ELF 可执行文件",
  so: "ELF 共享库",
  class: "Java 字节码",
  jar: "Java 包",
  wasm: "WebAssembly 字节码",
  dex: "Android DEX",
  mp4: "MP4 视频",
  mov: "QuickTime 视频",
  mp3: "MP3 音频",
  wav: "WAV 音频",
  ogg: "Ogg 容器",
  flac: "FLAC 音频",
  sqlite: "SQLite 数据库",
  db: "SQLite 数据库",
  ttf: "TrueType 字体",
  otf: "OpenType 字体",
  woff: "WOFF 字体",
  woff2: "WOFF2 字体",
  sql: "SQL 脚本",
  deb: "Debian 软件包",
  rpm: "RPM 软件包",
  dmg: "DMG 磁盘映像",
  iso: "ISO 映像",
};

interface MagicRule {
  name: string;
  bytes: number[];
  /** 匹配起始偏移，默认 0 */
  offset?: number;
}

function str(...codes: number[]): number[] {
  return codes;
}

/**
 * 魔数表（约 28 条常见格式）。
 * offset > 0 的规则排在前面：随机数据在靠后偏移处命中的概率低，先匹配可减少误判。
 */
const MAGIC_RULES: MagicRule[] = [
  { name: "WebP 图像", bytes: str(0x57, 0x45, 0x42, 0x50), offset: 8 },
  { name: "WAV 音频", bytes: str(0x57, 0x41, 0x56, 0x45), offset: 8 },
  { name: "MP4 视频", bytes: str(0x66, 0x74, 0x79, 0x70), offset: 4 },
  { name: "PNG 图像", bytes: str(0x89, 0x50, 0x4e, 0x47) },
  { name: "JPEG 图像", bytes: str(0xff, 0xd8, 0xff) },
  { name: "GIF 图像", bytes: str(0x47, 0x49, 0x46, 0x38) },
  { name: "BMP 图像", bytes: str(0x42, 0x4d) },
  { name: "ICO 图标", bytes: str(0x00, 0x00, 0x01, 0x00) },
  { name: "Photoshop 图像", bytes: str(0x38, 0x42, 0x50, 0x53) },
  { name: "PDF 文档", bytes: str(0x25, 0x50, 0x44, 0x46) },
  { name: "ZIP 压缩包", bytes: str(0x50, 0x4b, 0x03, 0x04) },
  { name: "ELF 可执行文件", bytes: str(0x7f, 0x45, 0x4c, 0x46) },
  { name: "Windows 可执行文件", bytes: str(0x4d, 0x5a) },
  { name: "GZIP 压缩", bytes: str(0x1f, 0x8b) },
  { name: "BZIP2 压缩", bytes: str(0x42, 0x5a, 0x68) },
  { name: "XZ 压缩", bytes: str(0xfd, 0x37, 0x7a, 0x58, 0x5a, 0x00) },
  { name: "7-Zip 压缩", bytes: str(0x37, 0x7a, 0xbc, 0xaf) },
  { name: "RAR 压缩", bytes: str(0x52, 0x61, 0x72, 0x21) },
  { name: "MP3 音频", bytes: str(0x49, 0x44, 0x33) },
  { name: "Ogg 容器", bytes: str(0x4f, 0x67, 0x67, 0x53) },
  { name: "FLAC 音频", bytes: str(0x66, 0x4c, 0x61, 0x43) },
  { name: "SQLite 数据库", bytes: str(0x53, 0x51, 0x4c, 0x69, 0x74, 0x65) },
  { name: "Android DEX", bytes: str(0x64, 0x65, 0x78, 0x0a) },
  { name: "Java 字节码", bytes: str(0xca, 0xfe, 0xba, 0xbe) },
  { name: "WebAssembly 字节码", bytes: str(0x00, 0x61, 0x73, 0x6d) },
  { name: "TrueType 字体", bytes: str(0x00, 0x01, 0x00, 0x00) },
  { name: "OpenType 字体", bytes: str(0x4f, 0x54, 0x54, 0x4f) },
  { name: "WOFF 字体", bytes: str(0x77, 0x4f, 0x46, 0x46) },
  { name: "WOFF2 字体", bytes: str(0x77, 0x4f, 0x46, 0x32) },
];

/** 魔数识别，无命中返回 null */
export function detectByMagic(bytes: Uint8Array): string | null {
  for (const rule of MAGIC_RULES) {
    const start = rule.offset ?? 0;
    if (bytes.length < start + rule.bytes.length) continue;
    let matched = true;
    for (let i = 0; i < rule.bytes.length; i++) {
      if (bytes[start + i] !== rule.bytes[i]) {
        matched = false;
        break;
      }
    }
    if (matched) return rule.name;
  }
  return null;
}

/**
 * 识别文件类型。
 * 优先级：扩展名 → 魔数 → 未知。扩展名命中时不做二次校正，
 * 但若魔数指向不同类型，会置 mismatch 供 UI 提示。
 */
export function detectFormat(filename: string, bytes: Uint8Array): FormatInfo {
  const byExtension = EXTENSION_MAP[getFileExtension(filename)];
  const byMagic = detectByMagic(bytes);

  if (byExtension) {
    return {
      name: byExtension,
      source: "extension",
      mismatch: Boolean(byMagic && byMagic !== byExtension),
      magicName: byMagic,
    };
  }
  if (byMagic) {
    return { name: byMagic, source: "magic", mismatch: false, magicName: byMagic };
  }
  return { name: "未知格式", source: "unknown", mismatch: false, magicName: null };
}

/** 手动指定用的候选类型列表（去重后的全部已知类型） */
export const FORMAT_OPTIONS: string[] = Array.from(
  new Set([...Object.values(EXTENSION_MAP), ...MAGIC_RULES.map((r) => r.name)])
).sort((a, b) => a.localeCompare(b, "zh-CN"));
