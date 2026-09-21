import "../../app/globals.css";
import "../../app/demo.css";

export const metadata = {
  title: "AI 審圖老師｜GitHub Pages 測試版",
  description: "靜態測試版：圖面與題目 PDF 僅在瀏覽器本機預覽，不會上傳或保存。"
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
