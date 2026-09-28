import fs from "fs";
import path from "path";
import https from "https";
import { execSync } from "child_process";

const url = "https://github.com/router-for-me/CLIProxyAPI/releases/download/v7.3.17/CLIProxyAPI_7.3.17_windows_amd64.zip";
const destZip = path.resolve(process.cwd(), "cliproxy.zip");

console.log("[CLIProxyAPI 下載工具] 正在下載官方 Windows 執行檔...");
console.log("下載網址:", url);

function downloadFile(sourceUrl, targetPath) {
  return new Promise((resolve, reject) => {
    function get(currentUrl) {
      https.get(currentUrl, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          get(res.headers.location);
          return;
        }
        if (res.statusCode !== 200) {
          reject(new Error(`下載失敗，HTTP 狀態碼: ${res.statusCode}`));
          return;
        }
        const fileStream = fs.createWriteStream(targetPath);
        res.pipe(fileStream);
        fileStream.on("finish", () => {
          fileStream.close();
          resolve();
        });
        fileStream.on("error", reject);
      }).on("error", reject);
    }
    get(sourceUrl);
  });
}

try {
  await downloadFile(url, destZip);
  console.log("[下載完成] 正在解壓縮 cliproxy.zip 至專案根目錄...");
  execSync(`tar -xf "${destZip}"`, { stdio: "inherit" });
  if (fs.existsSync(destZip)) {
    fs.unlinkSync(destZip);
  }
  console.log("[解壓完成] CLIProxyAPI 已成功就緒！");

  // 檢測當前目錄下的 exe
  const files = fs.readdirSync(process.cwd()).filter(f => f.includes("proxy") || f.endsWith(".exe"));
  console.log("相關執行檔:", files);
} catch (error) {
  console.error("[下載或解壓失敗]:", error);
  process.exit(1);
}
