"use client";

import { Scissors } from "lucide-react";

interface VideoTrimEditorProps {
  /** 视频总时长（秒）；0 = 未知 */
  duration: number;
  start: number;
  /** null = 到片尾 */
  end: number | null;
  onChange: (start: number, end: number | null) => void;
  /** 取预览播放器当前时间（秒），用于「设开始 / 设结束」打点 */
  getCurrentTime: () => number;
}

const inputClass =
  "w-full rounded-lg border border-gray-200 bg-white px-3 py-2.5 text-sm focus:border-brand-500 focus:ring-1 focus:ring-brand-500 outline-none";

/**
 * 截取片段编辑器：起止时间数字输入 + 播放器打点。
 * 压缩与 GIF 两个工具共用。
 */
export function VideoTrimEditor({
  duration,
  start,
  end,
  onChange,
  getCurrentTime,
}: VideoTrimEditorProps) {
  const effectiveEnd = end ?? (duration > 0 ? duration : null);
  const clipLength =
    effectiveEnd !== null ? Math.max(0, effectiveEnd - start) : null;
  const invalid = effectiveEnd !== null && effectiveEnd <= start;

  const setStart = (v: number) => {
    const s = Math.max(0, v);
    // 开始时间不得晚于当前结束时间
    if (effectiveEnd !== null && s >= effectiveEnd) return;
    onChange(s, end);
  };

  const setEnd = (v: number | null) => {
    if (v !== null && v <= start) return;
    onChange(start, v);
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 text-sm font-medium text-gray-700">
        <Scissors className="h-4 w-4" />
        截取片段
        <span className="text-xs font-normal text-gray-400">
          （留空结束时间 = 到片尾）
        </span>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-xs text-gray-500 mb-1">开始时间（秒）</label>
          <div className="flex gap-2">
            <input
              type="number"
              min={0}
              step={0.1}
              value={start}
              onChange={(e) => setStart(Number(e.target.value))}
              className={inputClass}
            />
            <button
              type="button"
              title="将播放器当前时间设为开始时间"
              onClick={() => setStart(getCurrentTime())}
              className="shrink-0 rounded-lg border border-gray-200 px-2.5 text-xs text-gray-600 hover:bg-gray-50 transition-colors"
            >
              设开始
            </button>
          </div>
        </div>
        <div>
          <label className="block text-xs text-gray-500 mb-1">结束时间（秒）</label>
          <div className="flex gap-2">
            <input
              type="number"
              min={0}
              step={0.1}
              placeholder={duration > 0 ? String(duration) : "片尾"}
              value={end ?? ""}
              onChange={(e) =>
                setEnd(e.target.value === "" ? null : Number(e.target.value))
              }
              className={inputClass}
            />
            <button
              type="button"
              title="将播放器当前时间设为结束时间"
              onClick={() => setEnd(getCurrentTime())}
              className="shrink-0 rounded-lg border border-gray-200 px-2.5 text-xs text-gray-600 hover:bg-gray-50 transition-colors"
            >
              设结束
            </button>
          </div>
        </div>
      </div>

      {invalid ? (
        <p className="text-xs text-red-600">结束时间必须晚于开始时间</p>
      ) : (
        clipLength !== null && (
          <p className="text-xs text-gray-400">
            片段时长约 {clipLength.toFixed(1)} 秒
            {duration > 0 && ` / 总时长 ${duration.toFixed(1)} 秒`}
          </p>
        )
      )}
    </div>
  );
}
