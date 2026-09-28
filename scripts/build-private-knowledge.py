"""Incrementally index private course PDFs and drawings without copying originals into Git."""

import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys

IMAGE_EXTENSIONS = {".jpg", ".jpeg", ".png", ".webp", ".gif"}
EXCLUDED_PDF_NAMES = {
    "敷地臨摹作業-2025-07-05.pdf", "K圖會2025建築設計模擬考題-設計博物館設計.pdf",
    "K圖會-設計課模擬題目.pdf", "建築敷地考題2025第二次K圖會大評圖.pdf",
    "105170_0106_建築計畫與設計(圖書館與社區公共空間).pdf",
    "109年高考(設計)-城市未來生活體驗館設計.pdf", "098高考(設計)-休假與訓練中心.pdf",
    "95年歷史建築保存再利用社區.pdf", "共享公寓企劃.pdf",
}
EXCLUDED_PDF_PAGES = {
    "K圖會-陳伊建築師-partseven-建築計畫示範.pdf": {15, 20},
    "K圖會-20171029客評講師劭寧建築師考試分享.pdf": {41, 42, 43, 44},
}
EXCLUDED_IMAGE_PATHS = {
    "output/playwright/review-card-focus.png",
    "課程/20251102術科_設計課第三十五堂-1_A/第8堂課-吳凡課程1141102(日)/36-敷地配置-考題分析/109年專技(敷地)-都市國民小學新校園 (1).jpg",
    "課程/20251102術科_設計課第三十五堂-1_A/第8堂課-吳凡課程1141102(日)/36-敷地配置-考題分析/109年專技(敷地)-都市國民小學新校園 (2).jpg",
    "課程/20251102術科_設計課第三十五堂-1_A/第8堂課-吳凡課程1141102(日)/36-敷地配置-考題分析/109年專技(敷地)-都市國民小學新校園 (3).jpg",
    "課程/20251102術科_設計課第三十五堂-1_A/第8堂課-吳凡課程1141102(日)/36-敷地配置-考題分析/109年專技(敷地)-都市國民小學新校園 (4).jpg",
    "課程/20251102術科_設計課第三十五堂-1_A/第8堂課-吳凡課程1141102(日)/36-敷地配置-考題分析/110年專技(敷地)-某地方區政中心_頁面_1.jpg",
    "課程/20251102術科_設計課第三十五堂-1_A/第8堂課-吳凡課程1141102(日)/36-敷地配置-考題分析/110年專技(敷地)-某地方區政中心_頁面_2.jpg",
}
GENERATED_INDEX_DIR = "知識索引"


def excluded_source(path: Path, root: Path) -> bool:
    relative = path.relative_to(root)
    if GENERATED_INDEX_DIR in relative.parts:
        return True
    if path.suffix.lower() == ".pdf" and path.name in EXCLUDED_PDF_NAMES:
        return True
    return path.suffix.lower() in IMAGE_EXTENSIONS and relative.as_posix() in EXCLUDED_IMAGE_PATHS


def fingerprint(path: Path, root: Path) -> str:
    stat = path.stat()
    return hashlib.sha256(f"{path.relative_to(root).as_posix()}|{stat.st_size}|{stat.st_mtime_ns}".encode()).hexdigest()[:20]


def clean(text: str) -> str:
    return re.sub(r"[ \t]+", " ", text.replace("\x00", " ")).strip()


def chunks(text: str, size: int = 1000, overlap: int = 120):
    text = clean(text)
    if not text:
        return []
    result = []
    start = 0
    while start < len(text):
        end = min(len(text), start + size)
        if end < len(text):
            break_at = max(text.rfind("。", start + size // 2, end), text.rfind("\n", start + size // 2, end))
            if break_at > start:
                end = break_at + 1
        result.append(text[start:end].strip())
        if end == len(text):
            break
        start = max(start + 1, end - overlap)
    return [part for part in result if len(part) >= 12]


def run_text(command: list[str], timeout: int = 180) -> str:
    completed = subprocess.run(command, stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=timeout, check=False)
    if completed.returncode != 0:
        raise RuntimeError(completed.stderr.decode("utf-8", "replace")[:500])
    return completed.stdout.decode("utf-8", "replace")


def ocr_languages(tesseract: str | None, tessdata: Path | None) -> str | None:
    if not tesseract:
        return None
    try:
        command = [tesseract, "--list-langs"]
        if tessdata:
            command.extend(["--tessdata-dir", str(tessdata)])
        languages = run_text(command, 20)
    except Exception:
        return None
    available = set(languages.split())
    preferred = [name for name in ("chi_tra", "eng") if name in available]
    return "+".join(preferred) if preferred else None


def main() -> int:
    parser = argparse.ArgumentParser(description="Build local text/page/image RAG index from a private course folder.")
    parser.add_argument("source", type=Path, help="Private source folder, e.g. C:\\Users\\User\\Downloads\\K圖會")
    parser.add_argument("--output", type=Path, default=Path("knowledge/private/index.jsonl"))
    parser.add_argument("--ocr-images", action="store_true", help="OCR standalone images using installed Tesseract languages")
    args = parser.parse_args()
    root = args.source.resolve(strict=True)
    output = args.output.resolve()
    if not root.is_dir():
        parser.error("Source must be a directory")
    pdftotext = shutil.which("pdftotext")
    pdfinfo = shutil.which("pdfinfo")
    if not pdftotext or not pdfinfo:
        parser.error("Poppler pdftotext and pdfinfo are required")
    tesseract = shutil.which("tesseract") if args.ocr_images else None
    private_tessdata = output.parent / "tessdata"
    tessdata = private_tessdata if (private_tessdata / "chi_tra.traineddata").exists() else None
    langs = ocr_languages(tesseract, tessdata)
    output.parent.mkdir(parents=True, exist_ok=True)
    (output.parent / "source-root.txt").write_text(str(root), encoding="utf-8")
    existing: set[str] = set()
    if output.exists():
        for line in output.open("r", encoding="utf-8"):
            try:
                existing.add(json.loads(line)["id"])
            except (ValueError, KeyError):
                continue
    candidates = [path for path in root.rglob("*") if path.is_file() and
                  (path.suffix.lower() == ".pdf" or path.suffix.lower() in IMAGE_EXTENSIONS)
                  and GENERATED_INDEX_DIR not in path.relative_to(root).parts]
    excluded_sources = [path for path in candidates if excluded_source(path, root)]
    files = sorted((path for path in candidates if not excluded_source(path, root)), key=lambda path: str(path).casefold())
    counts = {"pdf": 0, "pages": 0, "text": 0, "images": 0, "ocr": 0, "errors": 0, "existing": len(existing), "excluded_sources": len(excluded_sources), "excluded_pages": 0}
    with output.open("a", encoding="utf-8") as writer:
        def append(row: dict):
            if row["id"] in existing:
                return
            writer.write(json.dumps(row, ensure_ascii=False) + "\n")
            existing.add(row["id"])
            writer.flush()

        for number, path in enumerate(files, 1):
            relative = path.relative_to(root).as_posix()
            digest = fingerprint(path, root)
            title = path.stem
            metadata = f"{path.parent.relative_to(root).as_posix().replace('/', ' ')} {title}"
            try:
                if path.suffix.lower() == ".pdf":
                    info = run_text([pdfinfo, str(path)], 45)
                    match = re.search(r"^Pages:\s+(\d+)", info, re.MULTILINE)
                    page_count = int(match.group(1)) if match else 0
                    pages = run_text([pdftotext, "-layout", "-enc", "UTF-8", str(path), "-"], 300).split("\f")
                    counts["pdf"] += 1
                    for page in range(1, max(page_count, len(pages)) + 1):
                        if page in EXCLUDED_PDF_PAGES.get(path.name, set()):
                            counts["excluded_pages"] += 1
                            continue
                        page_text = clean(pages[page - 1]) if page - 1 < len(pages) else ""
                        if page > page_count and not page_text:
                            continue
                        counts["pages"] += 1
                        base = {"source_title": title, "source_path": relative, "page": page,
                                "source_type": "course_material", "curation_status": "extracted"}
                        page_ref = f"pdf:{relative}#page={page}"
                        append({**base, "id": f"PV-{digest}-{page}", "kind": "image", "text": f"{metadata} 第{page}頁 {page_text[:900]}",
                                "image_ref": page_ref, "ocr_status": "embedded_text" if page_text else "needs_visual_reading"})
                        counts["images"] += 1
                        for i, piece in enumerate(chunks(page_text)):
                            append({**base, "id": f"PT-{digest}-{page}-{i}", "kind": "text", "text": piece,
                                    "image_ref": page_ref})
                            counts["text"] += 1
                else:
                    ocr = ""
                    status = "not_requested"
                    if langs:
                        try:
                            command = [tesseract, str(path), "stdout", "-l", langs]
                            if tessdata:
                                command.extend(["--tessdata-dir", str(tessdata)])
                            ocr = clean(run_text(command, 90))[:8000]
                            status = "ocr_chi_tra_text_needs_review" if "chi_tra" in langs else "ocr_text_needs_review"
                            counts["ocr"] += 1
                        except Exception:
                            status = "ocr_failed"
                    elif args.ocr_images:
                        status = "ocr_language_unavailable"
                    append({"id": f"IMG-{digest}", "kind": "image", "source_title": title,
                            "source_path": relative, "page": None, "source_type": "course_material",
                            "curation_status": "extracted", "text": f"{metadata} {ocr}",
                            "image_ref": relative, "ocr_status": status})
                    counts["images"] += 1
            except Exception as error:
                counts["errors"] += 1
                print(f"ERROR {relative}: {error}", file=sys.stderr, flush=True)
            if number % 10 == 0 or number == len(files):
                print(json.dumps({"processed": number, "total": len(files), **counts}, ensure_ascii=False), flush=True)
    print(f"Index: {output}", flush=True)
    return 0 if counts["errors"] == 0 else 1


if __name__ == "__main__":
    raise SystemExit(main())
