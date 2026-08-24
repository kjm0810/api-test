import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = { title: "Stream Overlay", description: "SOOP·치지직 오버레이 설정/렌더" };
export default function Layout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="ko"><body>{children}</body></html>;
}
