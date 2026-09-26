"""Add selective Traditional Chinese OCR text to an existing private visual index."""

import argparse
import hashlib
from io import BytesIO
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
from PIL import Image


def chunks(text: str, size: int = 850, overlap: int = 100):
    start = 0
    while start < len(text):
        end = min(len(text), start + size)
        yield text[start:end]
        if end == len(text):
            return
        start = end - overlap


def main() -> int:
    parser = argparse.ArgumentParser(description="OCR K圖會 pictures and image-only PDF pages in Traditional Chinese.")
    parser.add_argument("--index", type=Path, default=Path("knowledge/private/index.jsonl"))
    parser.add_argument("--limit", type=int, default=0)
    parser.add_argument("--pdf-only", action="store_true", help="Prioritize image-only PDF pages")
    parser.add_argument("--shards", type=int, default=1)
    parser.add_argument("--shard", type=int, default=0)
    args = parser.parse_args()
    if args.shards < 1 or not 0 <= args.shard < args.shards:
        parser.error("--shard must be between 0 and --shards - 1")
    index_file = args.index.resolve(strict=True)
    folder = index_file.parent
    root = Path((folder / "source-root.txt").read_text(encoding="utf-8").strip()).resolve(strict=True)
    tessdata = folder / "tessdata"
    if not (tessdata / "chi_tra.traineddata").exists():
        parser.error(f"Traditional Chinese OCR model missing: {tessdata / 'chi_tra.traineddata'}")
    tesseract = shutil.which("tesseract")
    pdftoppm = shutil.which("pdftoppm")
    if not tesseract or not pdftoppm:
        parser.error("Tesseract and Poppler pdftoppm are required")
    output = folder / (f"ocr-augmentation-{args.shard}.jsonl" if args.shards > 1 else "ocr-augmentation.jsonl")
    existing = set()
    for previous in folder.glob("ocr-augmentation*.jsonl"):
        for line in previous.open("r", encoding="utf-8"):
            try:
                existing.add(json.loads(line)["id"])
            except (ValueError, KeyError):
                continue
    rows = []
    for line in index_file.open("r", encoding="utf-8"):
        try:
            row = json.loads(line)
            is_pdf = str(row.get("image_ref", "")).startswith("pdf:")
            if row.get("kind") == "image" and row.get("ocr_status") != "ocr_chi_tra_text_needs_review" and (not is_pdf or
                                               row.get("ocr_status") == "needs_visual_reading") and (not args.pdf_only or is_pdf):
                rows.append(row)
        except ValueError:
            continue
    rows = [row for index, row in enumerate(rows) if index % args.shards == args.shard]
    if args.limit > 0:
        rows = rows[:args.limit]
    counts = {"scanned": 0, "accepted": 0, "rejected_noise": 0, "errors": 0, "new_chunks": 0}
    with output.open("a", encoding="utf-8") as writer:
        for row in rows:
            base_id = f"OCR-{row['id']}"
            if f"{base_id}-0" in existing:
                continue
            try:
                ref = row["image_ref"]
                if ref.startswith("pdf:"):
                    match = re.fullmatch(r"pdf:(.+)#page=(\d+)", ref)
                    if not match:
                        raise RuntimeError("Invalid PDF image reference")
                    source = (root / match.group(1)).resolve(strict=True)
                    if not source.is_relative_to(root):
                        raise RuntimeError("PDF path outside source root")
                    render_dir = folder / "rendered"
                    render_dir.mkdir(parents=True, exist_ok=True)
                    base = render_dir / hashlib.sha256(row["id"].encode()).hexdigest()[:24]
                    image_path = base.with_suffix(".jpg")
                    if not image_path.exists():
                        result = subprocess.run([pdftoppm, "-f", match.group(2), "-l", match.group(2),
                                                 "-scale-to", "1600", "-jpeg", "-singlefile", str(source), str(base)],
                                                stdout=subprocess.DEVNULL, stderr=subprocess.PIPE, timeout=90)
                        if result.returncode:
                            raise RuntimeError(result.stderr.decode("utf-8", "replace")[:250])
                else:
                    image_path = (root / ref).resolve(strict=True)
                    if not image_path.is_relative_to(root):
                        raise RuntimeError("Image path outside source root")
                with Image.open(image_path) as image:
                    prepared = image.convert("RGB")
                    prepared.thumbnail((2000, 2000))
                    stream = BytesIO()
                    prepared.save(stream, format="JPEG", quality=84)
                result = subprocess.run([tesseract, "stdin", "stdout", "--tessdata-dir", str(tessdata),
                                         "-l", "chi_tra+eng", "--psm", "11"], input=stream.getvalue(),
                                        stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=60,
                                        env={**os.environ, "OMP_THREAD_LIMIT": "1"})
                if result.returncode:
                    raise RuntimeError(result.stderr.decode("utf-8", "replace")[:250])
                text = re.sub(r"[ \t]+", " ", result.stdout.decode("utf-8", "replace").replace("\x00", " ")).strip()
                han = len(re.findall(r"[\u3400-\u9fff]", text))
                usable = han >= 12 and han / max(1, len(text)) >= 0.07
                counts["scanned"] += 1
                if not usable:
                    counts["rejected_noise"] += 1
                    continue
                counts["accepted"] += 1
                for index, piece in enumerate(chunks(text[:10000])):
                    if len(piece.strip()) < 20:
                        continue
                    record = {"id": f"{base_id}-{index}", "kind": "text", "source_title": row["source_title"],
                              "source_path": row["source_path"], "page": row.get("page"), "text": piece.strip(),
                              "image_ref": ref, "source_type": "course_material", "curation_status": "extracted",
                              "ocr_status": "ocr_text_needs_review"}
                    writer.write(json.dumps(record, ensure_ascii=False) + "\n")
                    writer.flush()
                    existing.add(record["id"])
                    counts["new_chunks"] += 1
            except Exception as error:
                counts["errors"] += 1
                print(f"ERROR {row['id']}: {error}", flush=True)
            if counts["scanned"] % 25 == 0 and counts["scanned"]:
                print(json.dumps(counts, ensure_ascii=False), flush=True)
    print(json.dumps(counts, ensure_ascii=False), flush=True)
    return 0 if counts["errors"] == 0 else 1


if __name__ == "__main__":
    raise SystemExit(main())
