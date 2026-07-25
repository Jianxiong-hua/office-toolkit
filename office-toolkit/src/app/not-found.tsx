import Link from "next/link";
import { Home } from "lucide-react";

export default function NotFound() {
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center text-center">
      <h1 className="text-6xl font-extrabold text-gray-200">404</h1>
      <p className="mt-4 text-lg text-gray-500">页面未找到</p>
      <Link
        href="/"
        className="mt-6 inline-flex items-center gap-2 rounded-xl bg-brand-600 px-5 py-2.5 text-white font-medium hover:bg-brand-700 transition-colors"
      >
        <Home className="h-4 w-4" />
        返回首页
      </Link>
    </div>
  );
}
