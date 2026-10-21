import type { Metadata } from "next";
import "./globals.css";
export const metadata: Metadata = { title: "Workspace Hub · Moduvela", description: "本地产品、工具、框架和流程目录" };
export default function RootLayout({ children }: { children: React.ReactNode }) { return <html lang="zh-CN"><body>{children}</body></html>; }
