import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = { title: "Stream API Console", description: "SOOP·치지직 통합 API 관리" };
export default function Layout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="ko"><body>{children}</body></html>;
}
