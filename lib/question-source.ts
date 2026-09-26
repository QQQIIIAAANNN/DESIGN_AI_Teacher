import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { questionBankCatalog } from "@/data/question-bank";

export type QuestionDocument = {
  title: string;
  sourceKind: "official" | "upload";
  sourceUrl?: string;
  text: string;
  pageImages: string[];
  pageCount: number;
};

const MAX_PDF_BYTES = 25 * 1024 * 1024;
const officialCache = new Map<string, { expires: number; document: QuestionDocument }>();

function popplerExecutable(command: string) {
  const executable = process.platform === "win32" ? `${command}.exe` : command;
  const directories = [
    process.env.POPPLER_BIN_DIR?.trim(),
    path.join(process.cwd(), "tools", "poppler", "bin"),
    path.join(homedir(), ".cache", "codex-runtimes", "codex-primary-runtime", "dependencies", "native", "poppler", "Library", "bin")
  ].filter((item): item is string => Boolean(item));
  const found = directories.map((directory) => path.join(directory, executable)).find(existsSync);
  return found || command;
}

function runPoppler(command: string, args: string[], input: Buffer, outputLimit: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const child = spawn(popplerExecutable(command), args, { windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
    const chunks: Buffer[] = [];
    let size = 0;
    let stderr = "";
    let settled = false;
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    const finish = (error?: Error, output?: Buffer) => {
      if (settled) return;
      settled = true;
      if (timeoutId) clearTimeout(timeoutId);
      if (error) reject(error); else resolve(output || Buffer.alloc(0));
    };
    timeoutId = setTimeout(() => {
      child.kill();
      finish(new Error(`讀取題目 PDF 逾時（${command}）。請檢查 PDF 或改用較小的檔案。`));
    }, 30000);
    child.on("error", (error) => finish(new Error(`找不到 PDF 讀取工具 ${command}。請設定 POPPLER_BIN_DIR，指向 Poppler 的 bin 資料夾。（${error.message}）`)));
    child.stdout.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > outputLimit) {
        child.kill();
        finish(new Error("題目 PDF 輸出過大，請使用較小的檔案。"));
      } else chunks.push(chunk);
    });
    child.stderr.on("data", (chunk: Buffer) => { stderr += chunk.toString("utf8").slice(0, 1000); });
    child.on("close", (code) => code === 0
      ? finish(undefined, Buffer.concat(chunks))
      : finish(new Error(`${command} 無法讀取題目 PDF（${stderr.trim() || `代碼 ${code}`}）。`)));
    child.stdin.on("error", () => {});
    child.stdin.end(input);
  });
}

async function readPdf(bytes: Buffer, title: string, sourceKind: "official" | "upload", sourceUrl?: string): Promise<QuestionDocument> {
  if (bytes.length > MAX_PDF_BYTES || bytes.subarray(0, 5).toString("ascii") !== "%PDF-") {
    throw new Error("題目檔必須是 25 MB 以下的有效 PDF。");
  }
  const textResult = await runPoppler("pdftotext", ["-layout", "-enc", "UTF-8", "-", "-"], bytes, 2 * 1024 * 1024);
  const text = textResult.toString("utf8").replace(/\u0000/g, "").trim().slice(0, 24000);
  let pageCount = 1;
  try {
    const info = (await runPoppler("pdfinfo", ["-"], bytes, 10000)).toString("utf8");
    const count = info.match(/^Pages:\s*(\d+)/m);
    if (count) pageCount = Math.max(1, Number(count[1]));
  } catch { /* Continue with the first page when page count is unavailable. */ }
  const pageImages: string[] = [];
  for (let page = 1; page <= Math.min(pageCount, 5); page += 1) {
    try {
      const image = await runPoppler("pdftoppm", ["-f", String(page), "-l", String(page), "-singlefile", "-scale-to", "1500", "-png", "-"], bytes, 8 * 1024 * 1024);
      if (image.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) {
        pageImages.push(`data:image/png;base64,${image.toString("base64")}`);
      }
    } catch {
      if (!text) throw new Error("題目 PDF 含圖面但無法轉成圖片，請確認 pdftoppm 可用。");
      break;
    }
  }
  if (!text && !pageImages.length) throw new Error("無法讀取題目 PDF 內容。");
  return { title, sourceKind, sourceUrl, text, pageImages, pageCount };
}

export async function loadQuestionDocument(questionId?: string, upload?: File | null): Promise<QuestionDocument | null> {
  if (upload) {
    if (upload.size > MAX_PDF_BYTES) throw new Error("題目 PDF 超過 25 MB。");
    return readPdf(Buffer.from(await upload.arrayBuffer()), upload.name.replace(/\.pdf$/i, ""), "upload");
  }
  if (!questionId) return null;
  const question = questionBankCatalog.find((item) => item.id === questionId);
  if (!question) throw new Error("找不到選定的題目索引。");
  const cached = officialCache.get(questionId);
  if (cached && cached.expires > Date.now()) return cached.document;
  const url = new URL(question.sourceUrl);
  if (url.protocol !== "https:" || url.hostname !== "wwwq.moex.gov.tw") throw new Error("題目來源不是受信任的官方 PDF 位址。");
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 20000);
  try {
    const response = await fetch(url, { signal: controller.signal, headers: { Accept: "application/pdf" }, cache: "no-store" });
    if (!response.ok) throw new Error(`官方題目 PDF 讀取失敗（HTTP ${response.status}）。可改用題目 PDF 上傳。`);
    const declaredLength = Number(response.headers.get("content-length") || 0);
    if (declaredLength > MAX_PDF_BYTES) throw new Error("官方題目 PDF 過大，請使用較小的檔案。");
    const bytes = Buffer.from(await response.arrayBuffer());
    const document = await readPdf(bytes, `${question.year} 年 ${question.title}`, "official", question.sourceUrl);
    if (officialCache.size >= 20) officialCache.delete(officialCache.keys().next().value || "");
    officialCache.set(questionId, { expires: Date.now() + 30 * 60 * 1000, document });
    return document;
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") throw new Error("讀取官方題目 PDF 逾時，可改用題目 PDF 上傳。");
    throw error;
  } finally { clearTimeout(timeoutId); }
}
