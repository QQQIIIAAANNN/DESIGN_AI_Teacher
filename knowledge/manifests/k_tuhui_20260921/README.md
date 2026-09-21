# K圖會 ingestion batch 2026-09-21

This directory is a local working batch aligned with the repository's source,
knowledge-unit, image-region, and taxonomy conventions.

## Files

- `sources.jsonl`: source inventory, hashes, provenance, content scope, and curated building types.
- `page_classifications.jsonl`: page-level classification and extraction exclusion flags.
- `knowledge_units.jsonl`: atomic extracted candidates with teacher/document/page provenance.
- `image_regions.jsonl`: normalized image bounding boxes and knowledge-unit links.
- `validation.json`: counts, dedup results, and referential-integrity checks.
- `REPORT.md`: concise batch summary and usage limitations.

## Curation status

All knowledge units remain `extracted`. None are `reviewed` or `canonical`.
OCR-derived units carry `ocr_text_needs_review`. Pure exam-prompt pages and
teacher-prompt-only pages are excluded from knowledge extraction. A
`hard_rule` is emitted only from technical-reference sources and still requires
authority/version review before canonical use.

## Privacy and rights

The raw PDFs and images are not included. The source material is private
educational material and must not be redistributed. Do not push this local
batch to a public remote until the rights and release scope have been reviewed.
