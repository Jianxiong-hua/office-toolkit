import Link from "next/link";
import { ArrowLeft, Home } from "lucide-react";

export function ToolLayout({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <div className="tool-container">
      <nav className="flex items-center gap-2 text-sm text-gray-400 mb-6">
        <Link href="/" className="hover:text-brand-600 transition-colors inline-flex items-center gap-1">
          <Home className="h-3.5 w-3.5" />
          首页
        </Link>
        <span>/</span>
        <span className="text-gray-600">{title}</span>
      </nav>

      <div className="mb-8">
        <h1 className="text-3xl font-bold text-gray-900">{title}</h1>
        <p className="mt-2 text-gray-500">{description}</p>
      </div>

      {children}
    </div>
  );
}
