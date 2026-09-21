import "../../app/globals.css";
import "../../app/demo.css";

export const metadata = {
  title: "AI 審圖老師｜GitHub Pages 測試版",
  description: "靜態 mock 測試版：上傳圖面只在瀏覽器本機預覽。"
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
