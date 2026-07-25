import Link from "next/link";
import type { ToolMeta } from "@/config/site";
import * as Icons from "lucide-react";
import { Crown, Wrench, type LucideProps } from "lucide-react";

const categoryColors: Record<string, string> = {
  image: "bg-green-100 text-green-600",
  pdf: "bg-red-100 text-red-600",
};

const categoryIconBg: Record<string, string> = {
  image: "bg-green-50 group-hover:bg-green-100",
  pdf: "bg-red-50 group-hover:bg-red-100",
};

export function ToolCard({ tool }: { tool: ToolMeta }) {
  // Dynamically get the icon component
  const IconComponent =
    (
      Icons as unknown as Record<
        string,
        React.ComponentType<LucideProps>
      >
    )[tool.icon] || Wrench;

  return (
    <Link
      href={tool.path}
      className="group relative flex flex-col rounded-2xl border border-gray-100 bg-white p-6 shadow-sm transition-all hover:shadow-md hover:border-brand-200 hover:-translate-y-0.5"
    >
      {tool.paid && (
        <span className="absolute top-4 right-4 inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-700">
          <Crown className="h-3 w-3" />
          Pro
        </span>
      )}
      <div
        className={`flex h-12 w-12 items-center justify-center rounded-xl transition-colors ${categoryIconBg[tool.category] || "bg-gray-50 group-hover:bg-gray-100"}`}
      >
        <IconComponent className={`h-6 w-6 ${categoryColors[tool.category] || "text-gray-600"}`} />
      </div>
      <h3 className="mt-4 font-semibold text-gray-900">{tool.name}</h3>
      <p className="mt-1.5 text-sm text-gray-500 leading-relaxed">{tool.description}</p>
      <div className="mt-4 flex flex-wrap gap-1.5">
        {tool.tags.slice(0, 3).map((tag) => (
          <span
            key={tag}
            className="rounded-md bg-gray-100 px-2 py-0.5 text-xs text-gray-500"
          >
            {tag}
          </span>
        ))}
      </div>
    </Link>
  );
}
