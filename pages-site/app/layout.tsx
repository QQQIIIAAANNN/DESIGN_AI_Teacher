import "../../app/globals.css";
import "../../app/demo.css";

export const metadata = {
  title: "AI 審圖老師｜建築設計與敷地檢討平台",
  description: "建築設計與敷地圖面檢討平台，支援題目年份選擇、練習圖上傳與結構化評分。"
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
