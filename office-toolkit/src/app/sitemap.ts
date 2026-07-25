import { MetadataRoute } from "next";
import { siteConfig } from "@/config/site";
import { tools } from "@/config/tools";

export const dynamic = "force-static";

export default function sitemap(): MetadataRoute.Sitemap {
  const baseUrl = siteConfig.url;

  const toolPages = tools.map((tool) => ({
    url: `${baseUrl}${tool.path}`,
    lastModified: new Date(),
    changeFrequency: "monthly" as const,
    priority: tool.featured ? 0.8 : 0.6,
  }));

  return [
    {
      url: baseUrl,
      lastModified: new Date(),
      changeFrequency: "weekly",
      priority: 1,
    },
    ...toolPages,
  ];
}
