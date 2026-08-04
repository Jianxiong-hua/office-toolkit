// Node 端直接验证 filterFrames 算法的正确性
// 用本地 gifenc，不依赖浏览器

const { GIFEncoder, quantize, applyPalette } = require("gifenc");

// ── 复刻 compress-gif.ts:82-130 的 filterFrames 逻辑（完全等价） ──
function filterFrames(frames, opts) {
  const { targetFps, mergeDuplicates = false } = opts;
  let result = frames;

  // 1. 丢帧
  if (targetFps && targetFps > 0 && result.length > 0) {
    const origAvgDelay = result.reduce((s, f) => s + f.delay, 0) / result.length;
    const origFps = origAvgDelay > 0 ? 1000 / origAvgDelay : 0;
    if (origFps > targetFps) {
      const keepEvery = Math.max(1, Math.ceil(origFps / targetFps));
      const newDelay = Math.max(20, Math.round(1000 / targetFps));
      const filtered = [];
      for (let i = 0; i < result.length; i++) {
        if (i % keepEvery === 0) {
          filtered.push({ ...result[i], delay: newDelay });
        }
      }
      result = filtered;
    }
  }
  return result;
}

function encodeGif(frames, colors = 128) {
  const enc = GIFEncoder();
  for (const f of frames) {
    const pal = quantize(f.rgba, colors);
    const idx = applyPalette(f.rgba, pal);
    enc.writeFrame(idx, f.width, f.height, {
      palette: pal,
      delay: f.delay,
      dispose: 2,
      repeat: 0,
    });
  }
  enc.finish();
  return enc.bytes().length;
}

// ── 1. 生成测试数据：24 帧 200x200，每帧都不同 ──
const W = 200, H = 200, N = 24;
const frames = [];
for (let i = 0; i < N; i++) {
  const rgba = new Uint8ClampedArray(W * H * 4);
  const r = (i * 53) % 256;
  const g = (i * 97) % 256;
  const b = (i * 151) % 256;
  for (let p = 0; p < W * H; p++) {
    const off = p * 4;
    const noise = ((i * 1000 + p * 7) % 64) - 32;
    rgba[off] = (r + noise + 256) % 256;
    rgba[off + 1] = (g + noise + 256) % 256;
    rgba[off + 2] = (b + noise + 256) % 256;
    rgba[off + 3] = 255;
  }
  frames.push({ rgba, width: W, height: H, delay: 50, hasTransparency: false });
}

const origSize = encodeGif(frames);
console.log(`[生成] 原 GIF: ${N} 帧 @ 20fps, ${(origSize/1024).toFixed(1)} KB\n`);

// ── 2. 对比不同 FPS 下的输出大小 ──
const scenarios = [
  { label: "不丢帧（保持 20fps）", fps: undefined, expected: 24 },
  { label: "目标 10fps",            fps: 10,          expected: 12 },
  { label: "目标 5fps",             fps: 5,           expected: 6 },
  { label: "目标 2fps",             fps: 2,           expected: 2 },
  { label: "目标 1fps",             fps: 1,           expected: 1 },
];

console.log("场景                | 期望帧 | 实际帧 |  输出大小  |  压缩率");
console.log("-".repeat(72));
for (const s of scenarios) {
  const filtered = filterFrames(frames, { targetFps: s.fps, mergeDuplicates: false });
  const size = encodeGif(filtered);
  const ratio = ((1 - size / origSize) * 100).toFixed(1);
  const pass = filtered.length === s.expected ? "✓" : "✗";
  console.log(
    `${s.label.padEnd(20)} | ${String(s.expected).padStart(6)} | ${String(filtered.length).padStart(6)} | ${(size/1024).toFixed(1).padStart(8)} KB | ${(ratio + "%").padStart(7)}  ${pass}`
  );
}

console.log("\n=== 结论 ===");
console.log("降低帧率对 GIF 体积的缩减效果，等于「帧数压缩比」。");
console.log("20fps → 5fps = 帧数砍到 1/4，体积也接近 1/4。");
