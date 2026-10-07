"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import { ToolLayout } from "@/components/layout/ToolLayout";
import { ErrorAlert } from "@/components/common/ErrorAlert";
import { readFileAsArrayBuffer } from "@/lib/file";
import { DEFAULT_BYTES_PER_LINE, formatOffset, parseOffset, totalLines } from "@/lib/bin/hex";
import { findHits, parseQuery, type SearchHits } from "@/lib/bin/search";
import { interpretAt } from "@/lib/bin/interpret";
import { detectFormat } from "@/lib/bin/magic";
import { HexView, type HexViewHandle } from "./HexView";
import { LoadZone } from "./LoadZone";
import { SidePanel } from "./SidePanel";
import { Toolbar } from "./Toolbar";
import { SearchBar } from "./SearchBar";
import { FileInfoBar } from "./FileInfoBar";

/** 硬上限：超过直接拒绝，避免 ArrayBuffer 撑爆内存 */
const MAX_FILE_SIZE = 100 * 1024 * 1024;

export default function BinViewerPage() {
  const [file, setFile] = useState<File | null>(null);
  const [bytes, setBytes] = useState<Uint8Array | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [bytesPerLine, setBytesPerLine] = useState<number>(DEFAULT_BYTES_PER_LINE);
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);

  const [offsetInput, setOffsetInput] = useState("");
  const [offsetError, setOffsetError] = useState<string | null>(null);

  const [searchInput, setSearchInput] = useState("");
  const [searchError, setSearchError] = useState<string | null>(null);
  const [searchMode, setSearchMode] = useState<"hex" | "ascii" | null>(null);
  const [hits, setHits] = useState<SearchHits | null>(null);
  const [hitCursor, setHitCursor] = useState(0);

  const [manualFormat, setManualFormat] = useState("");

  const hexViewRef = useRef<HexViewHandle>(null);

  const jumpTo = useCallback((index: number) => {
    setSelectedIndex(index);
    hexViewRef.current?.scrollToIndex(index);
  }, []);

  const handleFile = useCallback(async (f: File) => {
    setLoading(true);
    setError(null);
    try {
      const buffer = await readFileAsArrayBuffer(f);
      setBytes(new Uint8Array(buffer));
      setFile(f);
      setSelectedIndex(null);
      setOffsetInput("");
      setOffsetError(null);
      setSearchInput("");
      setSearchError(null);
      setSearchMode(null);
      setHits(null);
      setHitCursor(0);
      setManualFormat("");
    } catch {
      setError("文件读取失败，请重新选择");
    } finally {
      setLoading(false);
    }
  }, []);

  const handleReset = useCallback(() => {
    setFile(null);
    setBytes(null);
    setSelectedIndex(null);
    setOffsetInput("");
    setOffsetError(null);
    setSearchInput("");
    setSearchError(null);
    setSearchMode(null);
    setHits(null);
    setHitCursor(0);
    setManualFormat("");
  }, []);

  const handleJump = () => {
    if (!bytes) return;
    const value = parseOffset(offsetInput, bytes.length);
    if (value === null) {
      setOffsetError(
        `偏移量无效或超出范围（0 至 ${formatOffset(bytes.length - 1)}，十六进制）`
      );
      return;
    }
    setOffsetError(null);
    jumpTo(value);
  };

  const handleSearch = () => {
    if (!bytes) return;
    const parsed = parseQuery(searchInput);
    if (!parsed) {
      setSearchError("请输入十六进制字节串（如 FF 00）或文本（如 hello）");
      setHits(null);
      setSearchMode(null);
      return;
    }
    const result = findHits(bytes, parsed.bytes);
    setSearchError(null);
    setSearchMode(parsed.mode);
    setHits(result);
    setHitCursor(0);
    if (result.offsets.length > 0) jumpTo(result.offsets[0]);
  };

  const gotoHit = (delta: number) => {
    if (!hits || hits.offsets.length === 0) return;
    const next = (hitCursor + delta + hits.offsets.length) % hits.offsets.length;
    setHitCursor(next);
    jumpTo(hits.offsets[next]);
  };

  const handleClearSearch = () => {
    setSearchInput("");
    setSearchError(null);
    setSearchMode(null);
    setHits(null);
    setHitCursor(0);
  };

  const detected = useMemo(
    () => (file && bytes ? detectFormat(file.name, bytes) : null),
    [file, bytes]
  );
  const formatName = manualFormat || detected?.name || "未知格式";
  const lines = bytes ? totalLines(bytes.length, bytesPerLine) : 0;
  const interpret = useMemo(
    () => (bytes && selectedIndex !== null ? interpretAt(bytes, selectedIndex) : null),
    [bytes, selectedIndex]
  );
  const mismatch =
    detected?.mismatch && detected.magicName
      ? `扩展名指向「${detected.name}」，但文件内容识别为「${detected.magicName}」。请确认文件是否被改名。`
      : null;

  return (
    <ToolLayout
      title="二进制查看器"
      description="以 Hex 字节与 ASCII 字符查看二进制文件内容，支持偏移跳转、字节搜索与数值解释"
    >
      {error && <ErrorAlert message={error} onClose={() => setError(null)} />}

      {loading && (
        <div className="flex items-center gap-2 rounded-xl bg-gray-50 p-4 text-sm text-gray-500">
          <Loader2 className="h-4 w-4 animate-spin" />
          正在读取文件…
        </div>
      )}

      {!loading && !file && <LoadZone maxSize={MAX_FILE_SIZE} onFile={handleFile} />}

      {file && bytes && (
        <div className="space-y-4">
          <FileInfoBar
            file={file}
            byteLength={bytes.length}
            formatName={formatName}
            mismatch={mismatch}
            onFormatChange={setManualFormat}
            onReset={handleReset}
          />

          <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_300px]">
            <div className="min-w-0 space-y-3">
              <Toolbar
                bytesPerLine={bytesPerLine}
                onBytesPerLineChange={setBytesPerLine}
                offsetInput={offsetInput}
                onOffsetInputChange={setOffsetInput}
                offsetError={offsetError}
                onJump={handleJump}
                lines={lines}
              />

              {offsetError && (
                <div className="rounded-lg bg-amber-50 p-3 text-sm text-amber-700">
                  {offsetError}
                </div>
              )}

              <SearchBar
                value={searchInput}
                onValueChange={setSearchInput}
                onSearch={handleSearch}
                onGotoHit={gotoHit}
                onClear={handleClearSearch}
                error={searchError}
                mode={searchMode}
                hits={hits}
                hitCursor={hitCursor}
              />

              <HexView
                ref={hexViewRef}
                bytes={bytes}
                bytesPerLine={bytesPerLine}
                selectedIndex={selectedIndex}
                hitIndex={hitCursor > 0 && hits ? (hits.offsets[hitCursor - 1] ?? null) : null}
                onSelectByte={setSelectedIndex}
              />
            </div>

            <SidePanel
              hits={hits}
              hitCursor={hitCursor}
              onSelectHit={(i) => {
                if (!hits) return;
                setHitCursor(i);
                jumpTo(hits.offsets[i]);
              }}
              interpret={interpret}
            />
          </div>
        </div>
      )}
    </ToolLayout>
  );
}
