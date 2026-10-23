#!/usr/bin/env python3
"""Normalize every catalog product image to conservative LibTV-safe limits.

The script keeps file names and transparency, backs up every source image, and
writes a machine-readable report. It never enlarges an image.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import shutil
import sys
import tempfile
from pathlib import Path
from urllib.request import urlopen

from PIL import Image, ImageOps


IMAGE_EXTENSIONS = {".png", ".jpg", ".jpeg", ".webp"}


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for block in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def image_info(path: Path) -> dict:
    with Image.open(path) as image:
        width, height = image.size
        return {
            "width": width,
            "height": height,
            "pixels": width * height,
            "bytes": path.stat().st_size,
            "mode": image.mode,
            "format": image.format or path.suffix.lstrip(".").upper(),
            "sha256": sha256(path),
        }


def needs_normalization(info: dict, max_edge: int, max_bytes: int) -> bool:
    return (
        max(info["width"], info["height"]) > max_edge
        or info["pixels"] > max_edge * max_edge
        or info["bytes"] > max_bytes
    )


def resize_to_long_edge(image: Image.Image, long_edge: int) -> Image.Image:
    width, height = image.size
    current = max(width, height)
    if current <= long_edge:
        return image.copy()
    scale = long_edge / float(current)
    size = (max(1, round(width * scale)), max(1, round(height * scale)))
    return image.resize(size, Image.Resampling.LANCZOS)


def save_candidate(image: Image.Image, path: Path, extension: str, quality: int) -> None:
    if extension == ".png":
        if image.mode not in {"1", "L", "LA", "P", "RGB", "RGBA"}:
            image = image.convert("RGBA" if "A" in image.getbands() else "RGB")
        image.save(path, format="PNG", optimize=True, compress_level=9)
        return
    if extension in {".jpg", ".jpeg"}:
        if image.mode != "RGB":
            if "A" in image.getbands():
                background = Image.new("RGB", image.size, "white")
                background.paste(image, mask=image.getchannel("A"))
                image = background
            else:
                image = image.convert("RGB")
        image.save(path, format="JPEG", quality=quality, optimize=True, progressive=True, subsampling=0)
        return
    if extension == ".webp":
        image.save(path, format="WEBP", quality=quality, method=6, lossless=False)
        return
    raise ValueError(f"Unsupported image extension: {extension}")


def normalize_one(path: Path, max_edge: int, max_bytes: int) -> dict:
    before = image_info(path)
    if not needs_normalization(before, max_edge, max_bytes):
        return {"changed": False, "before": before, "after": before}

    extension = path.suffix.lower()
    quality = 92
    target_edge = min(max_edge, max(before["width"], before["height"]))
    temporary_path: Path | None = None

    with Image.open(path) as source:
        source.load()
        oriented = ImageOps.exif_transpose(source)
        while True:
            candidate = resize_to_long_edge(oriented, target_edge)
            handle, raw_path = tempfile.mkstemp(prefix=".libtv-normalize-", suffix=extension, dir=path.parent)
            os.close(handle)
            temporary_path = Path(raw_path)
            try:
                save_candidate(candidate, temporary_path, extension, quality)
            finally:
                candidate.close()

            candidate_bytes = temporary_path.stat().st_size
            if candidate_bytes <= max_bytes:
                break

            temporary_path.unlink(missing_ok=True)
            temporary_path = None
            if extension in {".jpg", ".jpeg", ".webp"} and quality > 72:
                quality -= 5
            else:
                target_edge = max(256, int(target_edge * 0.88))
            if target_edge <= 256 and quality <= 72:
                raise RuntimeError(f"Unable to reduce {path.name} below {max_bytes} bytes")

    if temporary_path is None:
        raise RuntimeError(f"No normalized output was created for {path.name}")
    os.replace(temporary_path, path)
    after = image_info(path)
    if needs_normalization(after, max_edge, max_bytes):
        raise RuntimeError(f"Normalized image still exceeds limits: {path}")
    return {"changed": True, "before": before, "after": after}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--products-url", default="http://127.0.0.1:3766/api/products")
    parser.add_argument("--image-dir", type=Path, help="Normalize one local product image directory without starting the workbench")
    parser.add_argument("--product-id", default="local-product")
    parser.add_argument("--product-name", default="本地产品")
    parser.add_argument("--backup-dir", type=Path, required=True)
    parser.add_argument("--report", type=Path, required=True)
    parser.add_argument("--max-edge", type=int, default=2048)
    parser.add_argument("--max-bytes", type=int, default=4 * 1024 * 1024)
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    if args.image_dir:
        products = [{
            "id": args.product_id,
            "name": args.product_name,
            "imageDir": str(args.image_dir.resolve()),
        }]
    else:
        products = json.load(urlopen(args.products_url, timeout=20))
    args.backup_dir.mkdir(parents=True, exist_ok=True)
    args.report.parent.mkdir(parents=True, exist_ok=True)
    report = {
        "policy": {
            "maxEdge": args.max_edge,
            "maxPixels": args.max_edge * args.max_edge,
            "maxBytes": args.max_bytes,
            "preserveTransparency": True,
            "preserveFileNames": True,
            "neverUpscale": True,
        },
        "backupDir": str(args.backup_dir),
        "products": [],
        "totals": {"products": 0, "images": 0, "changed": 0, "unchanged": 0, "failed": 0},
    }

    for product in products:
        root = Path(product["imageDir"])
        product_entry = {"id": product["id"], "name": product["name"], "imageDir": str(root), "images": []}
        backup_root = args.backup_dir / product["id"]
        backup_root.mkdir(parents=True, exist_ok=True)
        for path in sorted(root.iterdir()):
            if not path.is_file() or path.suffix.lower() not in IMAGE_EXTENSIONS:
                continue
            report["totals"]["images"] += 1
            backup_path = backup_root / path.name
            shutil.copy2(path, backup_path)
            image_entry = {"file": path.name, "path": str(path), "backupPath": str(backup_path)}
            try:
                result = normalize_one(path, args.max_edge, args.max_bytes)
                image_entry.update(result)
                report["totals"]["changed" if result["changed"] else "unchanged"] += 1
            except Exception as error:
                image_entry.update({"changed": False, "error": str(error)})
                report["totals"]["failed"] += 1
            product_entry["images"].append(image_entry)
        report["products"].append(product_entry)
        report["totals"]["products"] += 1

    args.report.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(report["totals"], ensure_ascii=False))
    return 1 if report["totals"]["failed"] else 0


if __name__ == "__main__":
    sys.exit(main())
