"""Add local CLIP image vectors to the private index. Uses a locally cached model."""

import argparse
import hashlib
import json
from pathlib import Path
import re
import shutil
import subprocess

TOPICS = {
    "brief": "architectural design brief and requirements", "site": "site context and urban fabric",
    "program": "architectural floor plan room program", "concept": "architectural concept diagram",
    "indoor_outdoor": "indoor outdoor semi outdoor transition in architecture",
    "openness": "open semi open enclosed architectural space", "privacy": "public private transition architectural plan",
    "spatial_sequence": "architectural spatial sequence and arrival", "entrance": "main entrance architectural plan",
    "circulation": "pedestrian vehicle circulation architectural site plan", "accessibility": "accessible ramp and elevator architectural plan",
    "operation": "building management flexible program plan", "environment": "daylight ventilation shading building section",
    "sustainability": "green building rainwater landscape sustainability", "structure": "structural columns grid architectural plan",
    "regulation": "building setback egress accessibility dimension plan", "representation": "architectural drawing annotations and graphic hierarchy",
}


def main() -> int:
    parser = argparse.ArgumentParser(description="Embed private drawing images with a cached CLIP model.")
    parser.add_argument("--index", type=Path, default=Path("knowledge/private/index.jsonl"))
    parser.add_argument("--model", default="openai/clip-vit-large-patch14")
    parser.add_argument("--include-pdf", action="store_true", help="Also render and embed every PDF page")
    parser.add_argument("--pdf-textless-only", action="store_true", help="Embed only PDF pages without embedded text")
    parser.add_argument("--limit", type=int, default=0, help="Maximum new images this run; 0 means all")
    args = parser.parse_args()

    import torch
    from PIL import Image
    from transformers import CLIPImageProcessor, CLIPModel, CLIPTokenizerFast

    index_file = args.index.resolve(strict=True)
    folder = index_file.parent
    root = Path((folder / "source-root.txt").read_text(encoding="utf-8").strip()).resolve(strict=True)
    output = folder / "image-embeddings.jsonl"
    topic_output = folder / "topic-embeddings.json"
    rows = []
    for line in index_file.open("r", encoding="utf-8"):
        try:
            row = json.loads(line)
            image_ref = str(row.get("image_ref", ""))
            selected = (args.pdf_textless_only and image_ref.startswith("pdf:") and row.get("ocr_status") == "needs_visual_reading") or (
                not args.pdf_textless_only and (args.include_pdf or not image_ref.startswith("pdf:")))
            if row.get("kind") == "image" and selected:
                rows.append(row)
        except ValueError:
            continue
    existing = set()
    if output.exists():
        for line in output.open("r", encoding="utf-8"):
            try:
                existing.add(json.loads(line)["id"])
            except (ValueError, KeyError):
                continue
    pending = [row for row in rows if row["id"] not in existing]
    if args.limit > 0:
        pending = pending[:args.limit]
    print(f"CLIP model={args.model}, new_images={len(pending)}, already_indexed={len(existing)}", flush=True)
    if not pending and topic_output.exists():
        return 0

    torch.set_num_threads(min(4, torch.get_num_threads()))
    model = CLIPModel.from_pretrained(args.model, local_files_only=True).eval()
    tokenizer = CLIPTokenizerFast.from_pretrained(args.model, local_files_only=True)
    processor = CLIPImageProcessor()
    with torch.inference_mode():
        tokens = tokenizer(list(TOPICS.values()), padding=True, truncation=True, return_tensors="pt")
        text_features = model.get_text_features(**tokens)
        text_features = torch.nn.functional.normalize(text_features, dim=-1)
    topic_output.write_text(json.dumps({"model": args.model, "vectors": {
        key: vector.tolist() for key, vector in zip(TOPICS, text_features)
    }}, ensure_ascii=False), encoding="utf-8")

    pdftoppm = shutil.which("pdftoppm")
    count = 0
    errors = 0
    with output.open("a", encoding="utf-8") as writer, torch.inference_mode():
        for row in pending:
            try:
                image_ref = row["image_ref"]
                if image_ref.startswith("pdf:"):
                    match = re.fullmatch(r"pdf:(.+)#page=(\d+)", image_ref)
                    if not match or not pdftoppm:
                        raise RuntimeError("PDF renderer unavailable")
                    source = (root / match.group(1)).resolve(strict=True)
                    if not source.is_relative_to(root):
                        raise RuntimeError("Image path escapes source folder")
                    render_dir = folder / "rendered"
                    render_dir.mkdir(parents=True, exist_ok=True)
                    name = hashlib.sha256(row["id"].encode()).hexdigest()[:24]
                    base = render_dir / name
                    image_path = base.with_suffix(".jpg")
                    if not image_path.exists():
                        result = subprocess.run([pdftoppm, "-f", match.group(2), "-l", match.group(2),
                                                 "-scale-to", "1200", "-jpeg", "-singlefile", str(source), str(base)],
                                                stdout=subprocess.DEVNULL, stderr=subprocess.PIPE, timeout=90)
                        if result.returncode:
                            raise RuntimeError(result.stderr.decode("utf-8", "replace")[:250])
                else:
                    image_path = (root / image_ref).resolve(strict=True)
                    if not image_path.is_relative_to(root):
                        raise RuntimeError("Image path escapes source folder")
                with Image.open(image_path) as image:
                    inputs = processor(images=image.convert("RGB"), return_tensors="pt")
                features = model.get_image_features(**inputs)
                vector = torch.nn.functional.normalize(features, dim=-1)[0].tolist()
                writer.write(json.dumps({"id": row["id"], "model": args.model, "vector": vector}) + "\n")
                writer.flush()
                count += 1
                if count % 10 == 0:
                    print(json.dumps({"embedded": count, "target": len(pending), "errors": errors}), flush=True)
            except Exception as error:
                errors += 1
                print(f"ERROR {row['id']}: {error}", flush=True)
    print(json.dumps({"embedded": count, "target": len(pending), "errors": errors}), flush=True)
    return 0 if errors == 0 else 1


if __name__ == "__main__":
    raise SystemExit(main())
