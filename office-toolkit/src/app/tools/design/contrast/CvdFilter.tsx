"use client";

/**
 * 色觉模拟（CVD）SVG 滤镜定义。
 * 原工具通过 feColorMatrix 模拟红/绿/蓝弱视，这里渲染为 SVG defs，
 * 预览区通过 style={{ filter: 'url(#cvd-...)' }} 引用。
 */

const MATRICES = [
  {
    id: "cvd-protanopia",
    values: `0.152286 1.052583 -0.204868 0 0
0.114503 0.786281 0.099216 0 0
-0.003882 -0.048116 1.051998 0 0
0 0 0 1 0`,
  },
  {
    id: "cvd-deuteranopia",
    values: `0.367322 0.860646 -0.227968 0 0
0.280085 0.672501 0.047413 0 0
-0.011820 0.042940 0.968915 0 0
0 0 0 1 0`,
  },
  {
    id: "cvd-tritanopia",
    values: `1.255528 -0.076749 -0.178779 0 0
-0.078411 0.930809 0.147602 0 0
0.004733 0.691367 0.303900 0 0
0 0 0 1 0`,
  },
];

export function CvdFilter() {
  return (
    <svg width="0" height="0" style={{ position: "absolute" }} aria-hidden="true">
      <defs>
        {MATRICES.map((m) => (
          <filter key={m.id} id={m.id} colorInterpolationFilters="sRGB">
            <feColorMatrix type="matrix" values={m.values} />
          </filter>
        ))}
      </defs>
    </svg>
  );
}
