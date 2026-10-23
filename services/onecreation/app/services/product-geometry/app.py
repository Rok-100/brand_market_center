from __future__ import annotations

import hashlib
import os
import re
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

import cv2
import httpx
import numpy as np
import uvicorn
from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse
from pydantic import BaseModel, ConfigDict, Field


DATA_DIR = Path(os.environ.get("PRODUCT_GEOMETRY_DATA_DIR", "/data/artifacts")).resolve()
PUBLIC_BASE_URL = os.environ.get("PRODUCT_GEOMETRY_PUBLIC_BASE_URL", "http://product-geometry:8000").rstrip("/")
MAX_DOWNLOAD_BYTES = max(1_048_576, int(os.environ.get("PRODUCT_GEOMETRY_MAX_DOWNLOAD_BYTES", str(25 * 1024 * 1024))))
DOWNLOAD_TIMEOUT_SECONDS = max(3.0, float(os.environ.get("PRODUCT_GEOMETRY_DOWNLOAD_TIMEOUT_SECONDS", "20")))

app = FastAPI(title="Product Geometry Service", version="1.0.0")


class GeometryRequest(BaseModel):
    model_config = ConfigDict(extra="allow")

    schemaVersion: str = "one-click-remake-geometry-v1"
    jobId: str = ""
    targetId: str = ""
    policy: str = "preserve_source_slots"
    quantityPolicy: str = "inherit_source_observation"
    sourceNodeKey: str
    sourceImageUrl: str
    sourceWidth: int = 0
    sourceHeight: int = 0
    observedCount: int | None = None
    sourceInstances: list[dict[str, Any]] = Field(default_factory=list)
    target: dict[str, Any] = Field(default_factory=dict)
    productReferenceUrls: list[str] = Field(default_factory=list)
    invariants: list[str] = Field(default_factory=list)


def error(code: str, message: str, status: int = 422, details: dict[str, Any] | None = None) -> HTTPException:
    return HTTPException(status_code=status, detail={"code": code, "message": message, **(details or {})})


def safe_segment(value: str, fallback: str) -> str:
    cleaned = re.sub(r"[^a-zA-Z0-9._-]+", "-", str(value or "")).strip("-._")
    return cleaned[:100] or fallback


def artifact_dir(request: GeometryRequest) -> Path:
    request_hash = hashlib.sha256(request.model_dump_json().encode("utf-8")).hexdigest()[:16]
    directory = DATA_DIR / safe_segment(request.jobId, "job") / safe_segment(request.targetId, "target") / safe_segment(request.sourceNodeKey, "source") / request_hash
    directory.mkdir(parents=True, exist_ok=True)
    return directory


async def download_image(url: str) -> np.ndarray:
    parsed = urlparse(url)
    if parsed.scheme not in {"http", "https"}:
        raise error("E_INPUT_URL", "几何服务只接受平台提供的 HTTP(S) 已签名资产地址")
    try:
        async with httpx.AsyncClient(follow_redirects=True, timeout=DOWNLOAD_TIMEOUT_SECONDS) as client:
            async with client.stream("GET", url) as response:
                response.raise_for_status()
                chunks: list[bytes] = []
                size = 0
                async for chunk in response.aiter_bytes():
                    size += len(chunk)
                    if size > MAX_DOWNLOAD_BYTES:
                        raise error("E_INPUT_TOO_LARGE", f"输入图片超过 {MAX_DOWNLOAD_BYTES} 字节限制", 413)
                    chunks.append(chunk)
    except HTTPException:
        raise
    except Exception as exc:
        raise error("E_DOWNLOAD_FAILED", f"下载输入图片失败：{exc}", 502) from exc
    encoded = np.frombuffer(b"".join(chunks), dtype=np.uint8)
    image = cv2.imdecode(encoded, cv2.IMREAD_UNCHANGED)
    if image is None:
        raise error("E_IMAGE_DECODE", "输入资产不是可解码图片")
    if image.ndim == 2:
        image = cv2.cvtColor(image, cv2.COLOR_GRAY2BGRA)
    elif image.shape[2] == 3:
        image = cv2.cvtColor(image, cv2.COLOR_BGR2BGRA)
    return image


def connected_border_white_alpha(image: np.ndarray, threshold: int = 244) -> np.ndarray:
    if image.shape[2] == 4 and np.any(image[:, :, 3] < 250):
        alpha = image[:, :, 3].copy()
        return cv2.GaussianBlur(alpha, (3, 3), 0)
    bgr = image[:, :, :3]
    near_white = np.all(bgr >= threshold, axis=2).astype(np.uint8)
    count, labels = cv2.connectedComponents(near_white, connectivity=8)
    border_labels = set(np.unique(np.concatenate([labels[0], labels[-1], labels[:, 0], labels[:, -1]])).tolist())
    background = np.zeros_like(near_white)
    for label in border_labels:
        if 0 < label < count:
            background[labels == label] = 1
    alpha = np.where(background == 1, 0, 255).astype(np.uint8)
    return cv2.GaussianBlur(alpha, (3, 3), 0)


def target_front_aspect(target: dict[str, Any], cutout: np.ndarray) -> float:
    ratio = target.get("fixedLengthWidthHeightRatio") or []
    if isinstance(ratio, list) and len(ratio) >= 3:
        horizontal = max(float(ratio[0] or 0), float(ratio[1] or 0))
        height = float(ratio[2] or 0)
        if horizontal > 0 and height > 0:
            return horizontal / height
    opaque = cv2.findNonZero((cutout[:, :, 3] > 8).astype(np.uint8))
    if opaque is not None:
        _, _, width, height = cv2.boundingRect(opaque)
        if width > 0 and height > 0:
            return width / height
    return cutout.shape[1] / max(1, cutout.shape[0])


def coordinate(value: float, extent: int) -> int:
    numeric = float(value)
    return int(round(numeric * extent)) if -1.5 <= numeric <= 1.5 else int(round(numeric))


def instance_box(instance: dict[str, Any], width: int, height: int) -> tuple[int, int, int, int]:
    raw = instance.get("bbox") or instance.get("box") or instance.get("boundingBox") or {}
    if isinstance(raw, list) and len(raw) >= 4:
        x, y, box_width, box_height = raw[:4]
    else:
        x = raw.get("x", raw.get("left", 0))
        y = raw.get("y", raw.get("top", 0))
        box_width = raw.get("width", float(raw.get("right", 0)) - float(x))
        box_height = raw.get("height", float(raw.get("bottom", 0)) - float(y))
    x_px = coordinate(x, width)
    y_px = coordinate(y, height)
    width_px = coordinate(box_width, width)
    height_px = coordinate(box_height, height)
    if width_px <= 0 or height_px <= 0:
        raise error("E_SOURCE_INSTANCE_INVALID", "源产品实例 bbox 无效")
    x_px = min(max(0, x_px), width - 1)
    y_px = min(max(0, y_px), height - 1)
    width_px = min(width_px, width - x_px)
    height_px = min(height_px, height - y_px)
    return x_px, y_px, width_px, height_px


def contact_point(instance: dict[str, Any], box: tuple[int, int, int, int], width: int, height: int) -> tuple[int, int]:
    raw = instance.get("contactPoint") or instance.get("contact") or {}
    if isinstance(raw, list) and len(raw) >= 2:
        x, y = raw[:2]
    elif isinstance(raw, dict) and raw.get("x") is not None and raw.get("y") is not None:
        x, y = raw["x"], raw["y"]
    else:
        return box[0] + box[2] // 2, box[1] + box[3]
    return coordinate(x, width), coordinate(y, height)


def crop_cutout(image: np.ndarray) -> np.ndarray:
    alpha = connected_border_white_alpha(image)
    cutout = image.copy()
    cutout[:, :, 3] = alpha
    nonzero = cv2.findNonZero((alpha > 8).astype(np.uint8))
    if nonzero is None:
        raise error("E_PRODUCT_CUTOUT_EMPTY", "目标产品素材抠图为空")
    x, y, width, height = cv2.boundingRect(nonzero)
    return cutout[y:y + height, x:x + width]


def alpha_blend(canvas: np.ndarray, overlay: np.ndarray, x: int, y: int) -> None:
    height, width = overlay.shape[:2]
    if x < 0 or y < 0 or x + width > canvas.shape[1] or y + height > canvas.shape[0]:
        raise error("E_LAYOUT_OVERFLOW", "目标产品按源槽位布局后越出画布")
    region = canvas[y:y + height, x:x + width]
    alpha = overlay[:, :, 3:4].astype(np.float32) / 255.0
    region[:, :, :3] = (overlay[:, :, :3] * alpha + region[:, :, :3] * (1 - alpha)).astype(np.uint8)
    region[:, :, 3] = np.maximum(region[:, :, 3], overlay[:, :, 3])


def write_png(path: Path, image: np.ndarray) -> None:
    if not cv2.imwrite(str(path), image):
        raise error("E_ARTIFACT_WRITE", f"无法写入几何产物：{path.name}", 500)


def artifact_url(path: Path) -> str:
    relative = path.relative_to(DATA_DIR).as_posix()
    return f"{PUBLIC_BASE_URL}/artifacts/{relative}"


@app.get("/health")
def health() -> dict[str, Any]:
    return {"ready": True, "service": "product-geometry", "policy": "preserve_source_slots"}


@app.get("/artifacts/{artifact_path:path}")
def get_artifact(artifact_path: str) -> FileResponse:
    resolved = (DATA_DIR / artifact_path).resolve()
    try:
        resolved.relative_to(DATA_DIR)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail="artifact not found") from exc
    if not resolved.is_file():
        raise HTTPException(status_code=404, detail="artifact not found")
    return FileResponse(resolved)


@app.post("/v1/product-geometry/prepare")
async def prepare_geometry(request: GeometryRequest) -> dict[str, Any]:
    if request.policy != "preserve_source_slots" or request.quantityPolicy != "inherit_source_observation":
        raise error("E_POLICY_UNSUPPORTED", "一键做同款只接受逐源槽位和源图数量继承策略")
    if not request.sourceInstances:
        raise error("E_SOURCE_INSTANCE_MISSING", "没有可靠源产品实例，禁止用固定坐标或猜测数量生成几何层")
    if not request.productReferenceUrls:
        raise error("E_INPUT_MISSING", "缺少目标 SKU 产品身份图")
    if request.observedCount is not None and request.observedCount != len(request.sourceInstances):
        raise error(
            "E_COUNT_CONFLICT",
            "源图观察数量与可靠实例数量不一致，需先人工核实",
            details={
                "sourceNodeKey": request.sourceNodeKey,
                "observedCount": request.observedCount,
                "reliableInstanceCount": len(request.sourceInstances),
            },
        )

    source = await download_image(request.sourceImageUrl)
    product = crop_cutout(await download_image(request.productReferenceUrls[0]))
    height, width = source.shape[:2]
    aspect = target_front_aspect(request.target, product)
    directory = artifact_dir(request)

    transparent = np.zeros((height, width, 4), dtype=np.uint8)
    edit_mask = np.zeros((height, width), dtype=np.uint8)
    product_protect_mask = np.zeros((height, width), dtype=np.uint8)
    shadow_hint = np.zeros((height, width), dtype=np.uint8)
    placements: list[dict[str, Any]] = []

    ordered_instances = sorted(request.sourceInstances, key=lambda item: float(item.get("occlusionOrder", 0)))
    for index, instance in enumerate(ordered_instances):
        box = instance_box(instance, width, height)
        contact_x, contact_y = contact_point(instance, box, width, height)
        target_height = box[3]
        target_width = max(1, int(round(target_height * aspect)))
        if target_width > box[2]:
            target_width = box[2]
            target_height = max(1, int(round(target_width / max(aspect, 1e-6))))
        target_x = int(round(contact_x - target_width / 2))
        target_y = int(round(contact_y - target_height))
        if target_x < 0 or target_y < 0 or target_x + target_width > width or target_y + target_height > height:
            raise error("E_LAYOUT_OVERFLOW", f"源实例 {instance.get('id', index + 1)} 的目标布局越界")

        resized = cv2.resize(product, (target_width, target_height), interpolation=cv2.INTER_AREA if target_height < product.shape[0] else cv2.INTER_CUBIC)
        alpha_blend(transparent, resized, target_x, target_y)
        product_protect_mask[target_y:target_y + target_height, target_x:target_x + target_width] = np.maximum(
            product_protect_mask[target_y:target_y + target_height, target_x:target_x + target_width], resized[:, :, 3]
        )
        margin = max(4, int(round(max(box[2], box[3]) * 0.08)))
        x1, y1 = max(0, box[0] - margin), max(0, box[1] - margin)
        x2, y2 = min(width, box[0] + box[2] + margin), min(height, box[1] + box[3] + margin)
        cv2.rectangle(edit_mask, (x1, y1), (x2, y2), 255, -1)
        cv2.ellipse(shadow_hint, (contact_x, min(height - 1, contact_y)), (max(3, target_width // 2), max(2, target_height // 28)), 0, 0, 360, 180, -1)
        placements.append({
            "sourceInstanceId": str(instance.get("id") or f"source-instance-{index + 1}"),
            "targetBox": {"x": target_x, "y": target_y, "width": target_width, "height": target_height},
            "contactPoint": {"x": contact_x, "y": contact_y},
            "occlusionOrder": instance.get("occlusionOrder", index)
        })

    kernel_size = max(3, int(round(min(width, height) * 0.008)) | 1)
    kernel = np.ones((kernel_size, kernel_size), dtype=np.uint8)
    outer = cv2.dilate(product_protect_mask, kernel, iterations=1)
    inner = cv2.erode(product_protect_mask, kernel, iterations=1)
    blend_ring = cv2.subtract(outer, inner)
    preview = source.copy()
    alpha_blend(preview, transparent, 0, 0)

    geometry_layer_path = directory / "geometry-layer.png"
    edit_mask_path = directory / "edit-mask.png"
    protect_mask_path = directory / "product-protect-mask.png"
    blend_ring_path = directory / "blend-ring-mask.png"
    shadow_hint_path = directory / "shadow-hint-mask.png"
    preview_path = directory / "preview.png"
    write_png(geometry_layer_path, transparent)
    write_png(edit_mask_path, edit_mask)
    write_png(protect_mask_path, product_protect_mask)
    write_png(blend_ring_path, blend_ring)
    write_png(shadow_hint_path, shadow_hint)
    write_png(preview_path, preview)

    return {
        "schemaVersion": "one-click-remake-geometry-result-v1",
        "status": "prepared",
        "jobId": request.jobId,
        "targetId": request.targetId,
        "sourceNodeKey": request.sourceNodeKey,
        "geometry": {
            "quantityPolicy": request.quantityPolicy,
            "layoutMode": request.policy,
            "sourceInstanceCount": len(request.sourceInstances),
            "targetInstanceCount": len(placements),
            "placements": placements
        },
        "artifacts": {
            "layoutGuideUrl": artifact_url(geometry_layer_path),
            "geometryLayerUrl": artifact_url(geometry_layer_path),
            "editMaskUrl": artifact_url(edit_mask_path),
            "productProtectMaskUrl": artifact_url(protect_mask_path),
            "blendRingMaskUrl": artifact_url(blend_ring_path),
            "shadowHintMaskUrl": artifact_url(shadow_hint_path),
            "previewUrl": artifact_url(preview_path)
        },
        "warnings": []
    }


if __name__ == "__main__":
    uvicorn.run(app, host=os.environ.get("PRODUCT_GEOMETRY_HOST", "0.0.0.0"), port=int(os.environ.get("PRODUCT_GEOMETRY_PORT", "8000")))
