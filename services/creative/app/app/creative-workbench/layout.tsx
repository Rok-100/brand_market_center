import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "创意创作台｜内容审核与协作",
  description: "面向品牌营销团队的文案审核、拍摄筹备、内容存档与艺人项目协作工作台。",
};

export default function CreativeWorkbenchLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return children;
}
