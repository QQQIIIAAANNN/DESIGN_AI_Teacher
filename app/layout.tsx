import "./globals.css";

export const metadata = {
  title: "AI 審圖老師",
  description: "建築師考試設計與敷地繪圖 AI 輔助練習平台",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-Hant">
      <body>{children}</body>
    </html>
  );
}
