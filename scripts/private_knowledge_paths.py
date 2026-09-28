"""Project-relative paths and shared source exclusions for the private knowledge corpus."""

import hashlib
import os
from pathlib import Path


PROJECT_ROOT = Path(__file__).resolve().parents[1]
IMAGE_EXTENSIONS = {".jpg", ".jpeg", ".png", ".webp", ".gif"}
SOURCE_EXTENSIONS = IMAGE_EXTENSIONS | {".pdf"}
EXCLUDED_DIRECTORY_NAMES = {"output", "知識索引"}
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
    "課程/20251102術科_設計課第三十五堂-1_A/第8堂課-吳凡課程1141102(日)/36-敷地配置-考題分析/109年專技(敷地)-都市國民小學新校園 (1).jpg",
    "課程/20251102術科_設計課第三十五堂-1_A/第8堂課-吳凡課程1141102(日)/36-敷地配置-考題分析/109年專技(敷地)-都市國民小學新校園 (2).jpg",
    "課程/20251102術科_設計課第三十五堂-1_A/第8堂課-吳凡課程1141102(日)/36-敷地配置-考題分析/109年專技(敷地)-都市國民小學新校園 (3).jpg",
    "課程/20251102術科_設計課第三十五堂-1_A/第8堂課-吳凡課程1141102(日)/36-敷地配置-考題分析/109年專技(敷地)-都市國民小學新校園 (4).jpg",
    "課程/20251102術科_設計課第三十五堂-1_A/第8堂課-吳凡課程1141102(日)/36-敷地配置-考題分析/110年專技(敷地)-某地方區政中心_頁面_1.jpg",
    "課程/20251102術科_設計課第三十五堂-1_A/第8堂課-吳凡課程1141102(日)/36-敷地配置-考題分析/110年專技(敷地)-某地方區政中心_頁面_2.jpg",
}


def project_path(value: str | Path, *, strict: bool = False) -> Path:
    candidate = Path(value).expanduser()
    if not candidate.is_absolute():
        candidate = PROJECT_ROOT / candidate
    return candidate.resolve(strict=strict)


def source_root_from(folder: Path) -> Path:
    reference = (folder / "source-root.txt").read_text(encoding="utf-8").strip()
    return project_path(reference, strict=True)


def relative_source_root(root: Path) -> str:
    try:
        return Path(os.path.relpath(root.resolve(), PROJECT_ROOT)).as_posix()
    except ValueError as error:
        raise ValueError("The source folder must be on a path relative to the project root.") from error


def source_file(root: Path, relative: str) -> Path | None:
    candidate = (root / relative).resolve()
    if not candidate.is_relative_to(root.resolve()):
        return None
    return candidate


def is_supported_source(path: Path) -> bool:
    return path.is_file() and path.suffix.lower() in SOURCE_EXTENSIONS


def is_excluded_source(path: Path, root: Path) -> bool:
    try:
        relative = path.relative_to(root)
    except ValueError:
        return True
    if any(part.startswith(".") or part in EXCLUDED_DIRECTORY_NAMES for part in relative.parts[:-1]):
        return True
    if path.suffix.lower() == ".pdf" and path.name in EXCLUDED_PDF_NAMES:
        return True
    return path.suffix.lower() in IMAGE_EXTENSIONS and relative.as_posix() in EXCLUDED_IMAGE_PATHS


def is_excluded_record(row: dict) -> bool:
    source_path = Path(str(row.get("source_path", "")))
    if source_path.suffix.lower() == ".pdf":
        try:
            page = int(row.get("page"))
        except (TypeError, ValueError):
            page = 0
        return page in EXCLUDED_PDF_PAGES.get(source_path.name, set())
    return False


def source_fingerprint(path: Path, root: Path) -> str:
    stat = path.stat()
    relative = path.relative_to(root).as_posix()
    value = f"{relative}|{stat.st_size}|{stat.st_mtime_ns}"
    return hashlib.sha256(value.encode()).hexdigest()[:20]


def render_cache_dir() -> Path:
    return PROJECT_ROOT / ".cache" / "knowledge" / "rendered"
