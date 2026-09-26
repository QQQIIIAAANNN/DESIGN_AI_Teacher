import "../../app/globals.css";
import "../../app/demo.css";

export const metadata = {
  title: "AI 審圖老師｜建築設計與敷地檢討平台",
  description: "建築設計與敷地圖面練習平台，支援分情境審圖、歷年案例模擬題、基地圖示意、知識檢索與卡片討論。"
};

export default function PagesLayout({
  children
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-Hant">
      <body>{children}</body>
    </html>
  );
}
