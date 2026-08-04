/**
 * pdfjs-dist worker bundle 没有自带 .d.ts
 * 这里只需声明模块存在（split.ts 中以 any 接收）
 * 真正的类型由 pdfjs-dist 顶层包提供
 */
declare module "pdfjs-dist/build/pdf.worker.min.mjs";
