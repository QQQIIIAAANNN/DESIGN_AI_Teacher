"""Audit, and optionally prune, the private knowledge index against synced sources."""

import argparse
import json
from pathlib import Path
import re

from private_knowledge_paths import (
    is_excluded_record,
    is_excluded_source,
    is_supported_source,
    project_path,
    source_file,
    source_fingerprint,
    source_root_from,
)

SOURCE_ID = re.compile(r"^(?:PV|PT|IMG)-([a-f0-9]{20})(?:-|$)")
OCR_ID = re.compile(r"^OCR-(.+)-\d+$")


def rows_from(file: Path):
    for line in file.open("r", encoding="utf-8"):
        if line.strip():
            try:
                yield json.loads(line)
            except ValueError:
                continue


def write_rows(file: Path, rows: list[dict]) -> None:
    temporary = file.with_name(f".{file.name}.tmp")
    with temporary.open("w", encoding="utf-8", newline="\n") as writer:
        for row in rows:
            writer.write(json.dumps(row, ensure_ascii=False) + "\n")
    temporary.replace(file)


def main() -> int:
    parser = argparse.ArgumentParser(description="Check the private index against the current cloud-synced source folder.")
    parser.add_argument("--index", type=Path, default=Path("knowledge/private/index.jsonl"))
    parser.add_argument("--source", type=Path, help="Source folder, relative to the project root")
    parser.add_argument("--prune-stale", action="store_true",
                        help="Remove excluded, missing, changed, and orphaned index/vector/OCR rows; never touches source files")
    args = parser.parse_args()

    index = project_path(args.index, strict=True)
    root = project_path(args.source, strict=True) if args.source else source_root_from(index.parent)
    if not root.is_dir():
        parser.error("Source must be a directory")

    base = list(rows_from(index))
    current = {
        path.relative_to(root).as_posix(): path
        for path in root.rglob("*")
        if is_supported_source(path) and not is_excluded_source(path, root)
    }
    indexed = {str(row["source_path"]) for row in base if row.get("source_path")}
    missing = sorted(indexed - current.keys())
    new = sorted(current.keys() - indexed)

    indexed_digests: dict[str, set[str]] = {}
    for row in base:
        match = SOURCE_ID.match(str(row.get("id", "")))
        if match and row.get("source_path"):
            indexed_digests.setdefault(str(row["source_path"]), set()).add(match.group(1))
    changed = sorted(
        relative for relative in indexed & current.keys()
        if indexed_digests.get(relative) != {source_fingerprint(current[relative], root)}
    )

    valid_base = []
    for row in base:
        relative = str(row.get("source_path", ""))
        source = source_file(root, relative) if relative else None
        match = SOURCE_ID.match(str(row.get("id", "")))
        if (source and source.is_file() and relative in current and match and
                match.group(1) == source_fingerprint(source, root) and not is_excluded_record(row)):
            valid_base.append(row)
    valid_image_ids = {str(row["id"]) for row in valid_base if row.get("kind") == "image" and row.get("id")}

    augmentation_files = sorted(index.parent.glob("ocr-augmentation*.jsonl"))
    augmentations = {file: list(rows_from(file)) for file in augmentation_files}
    valid_augmentations = {
        file: [row for row in rows if (match := OCR_ID.match(str(row.get("id", "")))) and match.group(1) in valid_image_ids]
        for file, rows in augmentations.items()
    }

    vector_file = index.parent / "image-embeddings.jsonl"
    vectors = list(rows_from(vector_file)) if vector_file.exists() else []
    valid_vectors = [row for row in vectors if str(row.get("id", "")) in valid_image_ids]

    result = {
        "source_files": len(current),
        "indexed_sources": len(indexed),
        "base_records": len(base),
        "usable_records": len(valid_base),
        "excluded_or_stale_records": len(base) - len(valid_base),
        "ocr_chunks": sum(map(len, augmentations.values())),
        "orphan_ocr_chunks": sum(map(len, augmentations.values())) - sum(map(len, valid_augmentations.values())),
        "image_vectors": len(vectors),
        "orphan_vectors": len(vectors) - len(valid_vectors),
        "missing_sources": len(missing),
        "new_sources": len(new),
        "changed_sources": len(changed),
        "missing_preview": missing[:10],
        "new_preview": new[:10],
        "changed_preview": changed[:10],
    }

    if args.prune_stale:
        write_rows(index, valid_base)
        for file, rows in valid_augmentations.items():
            write_rows(file, rows)
        if vector_file.exists():
            write_rows(vector_file, valid_vectors)
        result["pruned_records"] = len(base) - len(valid_base)
        result["pruned_ocr_chunks"] = result["orphan_ocr_chunks"]
        result["pruned_vectors"] = result["orphan_vectors"]

    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 1 if missing or new or changed else 0


if __name__ == "__main__":
    raise SystemExit(main())
