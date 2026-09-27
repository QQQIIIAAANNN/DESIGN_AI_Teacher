"""Read-only check that the private index matches the files still on disk."""

import argparse
import hashlib
import json
from pathlib import Path
import re


EXTENSIONS = {".pdf", ".jpg", ".jpeg", ".png", ".webp", ".gif"}
EXCLUDED_PDF_NAMES = {
    "敷地臨摹作業-2025-07-05.pdf", "K圖會2025建築設計模擬考題-設計博物館設計.pdf",
    "K圖會-設計課模擬題目.pdf", "建築敷地考題2025第二次K圖會大評圖.pdf",
    "105170_0106_建築計畫與設計(圖書館與社區公共空間).pdf",
    "109年高考(設計)-城市未來生活體驗館設計.pdf", "098高考(設計)-休假與訓練中心.pdf",
    "95年歷史建築保存再利用社區.pdf", "共享公寓企劃.pdf",
}
EXCLUDED_IMAGE_PATHS = {
    "課程/20251102術科_設計課第三十五堂-1_A/第8堂課-吳凡課程1141102(日)/36-敷地配置-考題分析/109年專技(敷地)-都市國民小學新校園 (1).jpg",
    "課程/20251102術科_設計課第三十五堂-1_A/第8堂課-吳凡課程1141102(日)/36-敷地配置-考題分析/109年專技(敷地)-都市國民小學新校園 (2).jpg",
    "課程/20251102術科_設計課第三十五堂-1_A/第8堂課-吳凡課程1141102(日)/36-敷地配置-考題分析/109年專技(敷地)-都市國民小學新校園 (3).jpg",
    "課程/20251102術科_設計課第三十五堂-1_A/第8堂課-吳凡課程1141102(日)/36-敷地配置-考題分析/109年專技(敷地)-都市國民小學新校園 (4).jpg",
    "課程/20251102術科_設計課第三十五堂-1_A/第8堂課-吳凡課程1141102(日)/36-敷地配置-考題分析/110年專技(敷地)-某地方區政中心_頁面_1.jpg",
    "課程/20251102術科_設計課第三十五堂-1_A/第8堂課-吳凡課程1141102(日)/36-敷地配置-考題分析/110年專技(敷地)-某地方區政中心_頁面_2.jpg",
}


def excluded_source(path: Path, root: Path) -> bool:
    relative = path.relative_to(root)
    if "知識索引" in relative.parts:
        return True
    if path.suffix.lower() == ".pdf" and path.name in EXCLUDED_PDF_NAMES:
        return True
    return path.suffix.lower() != ".pdf" and relative.as_posix() in EXCLUDED_IMAGE_PATHS
SOURCE_ID = re.compile(r"^(?:PV|PT|IMG)-([a-f0-9]{20})(?:-|$)")
OCR_ID = re.compile(r"^OCR-(.+)-\d+$")


def rows_from(file: Path):
    for line in file.open("r", encoding="utf-8"):
        if line.strip():
            try:
                yield json.loads(line)
            except ValueError:
                continue


def fingerprint(path: Path, root: Path) -> str:
    stat = path.stat()
    relative = path.relative_to(root).as_posix()
    return hashlib.sha256(f"{relative}|{stat.st_size}|{stat.st_mtime_ns}".encode()).hexdigest()[:20]


def main() -> int:
    parser = argparse.ArgumentParser(description="Check for deleted, added, or changed K圖會 sources without editing files.")
    parser.add_argument("--index", type=Path, default=Path("knowledge/private/index.jsonl"))
    parser.add_argument("--source", type=Path)
    args = parser.parse_args()
    index = args.index.resolve(strict=True)
    root = (args.source or Path((index.parent / "source-root.txt").read_text(encoding="utf-8").strip())).resolve(strict=True)
    if not root.is_dir():
        parser.error("Source must be a directory")

    base = list(rows_from(index))
    indexed = {row["source_path"] for row in base if row.get("source_path")}
    images = {row["id"] for row in base if row.get("kind") == "image"}
    current = {path.relative_to(root).as_posix(): path for path in root.rglob("*")
               if path.is_file() and path.suffix.lower() in EXTENSIONS and not excluded_source(path, root)}
    missing = sorted(indexed - current.keys())
    new = sorted(current.keys() - indexed)
    indexed_digests = {}
    for row in base:
        match = SOURCE_ID.match(row.get("id", ""))
        if match:
            indexed_digests.setdefault(row["source_path"], set()).add(match.group(1))
    changed = sorted(relative for relative in indexed & current.keys()
                     if indexed_digests.get(relative) != {fingerprint(current[relative], root)})

    orphan_ocr = 0
    ocr_chunks = 0
    for file in index.parent.glob("ocr-augmentation*.jsonl"):
        for row in rows_from(file):
            ocr_chunks += 1
            match = OCR_ID.match(row.get("id", ""))
            orphan_ocr += not match or match.group(1) not in images
    orphan_vectors = 0
    vectors = 0
    vector_file = index.parent / "image-embeddings.jsonl"
    if vector_file.exists():
        for row in rows_from(vector_file):
            vectors += 1
            orphan_vectors += row.get("id") not in images

    result = {
        "source_files": len(current), "pdf_files": sum(path.suffix.lower() == ".pdf" for path in current.values()),
        "standalone_images": sum(path.suffix.lower() != ".pdf" for path in current.values()),
        "indexed_sources": len(indexed), "base_records": len(base),
        "ocr_chunks": ocr_chunks, "image_vectors": vectors,
        "missing_sources": len(missing), "new_sources": len(new), "changed_sources": len(changed),
        "orphan_ocr_chunks": orphan_ocr, "orphan_vectors": orphan_vectors,
        "missing_preview": missing[:10], "new_preview": new[:10], "changed_preview": changed[:10],
    }
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 1 if missing or new or changed or orphan_ocr or orphan_vectors else 0


if __name__ == "__main__":
    raise SystemExit(main())
