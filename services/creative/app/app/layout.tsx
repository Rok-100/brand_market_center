import type { Metadata } from "next";
import { headers } from "next/headers";
import "./globals.css";
import "./creative-console.css";

export async function generateMetadata(): Promise<Metadata> {
  const requestHeaders = await headers();
  const host = requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host") ?? "localhost:3000";
  const protocol = requestHeaders.get("x-forwarded-proto") ?? (host.includes("localhost") ? "http" : "https");
  const basePath = host === "app.fandow.top" ? "/fd-023794/idea-os-creative" : "";
  const imageUrl = `${protocol}://${host}${basePath}/og-creative-console.png`;

  return {
    title: "IDEA OS｜创意智能中枢",
    description: "从日常脚本创作、人工审核到案例沉淀的一体化创意协作平台。",
    icons: { icon: `${basePath}/favicon.svg`, shortcut: `${basePath}/favicon.svg` },
    openGraph: {
      title: "IDEA OS｜创意智能中枢",
      description: "日常创作 · 两级审核 · 案例沉淀",
      images: [{ url: imageUrl, width: 1536, height: 1024, alt: "IDEA OS 创意智能中枢" }],
    },
    twitter: { card: "summary_large_image", images: [imageUrl] },
  };
}

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
