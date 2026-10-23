import asyncio
import tempfile
import unittest
from pathlib import Path

import cv2
import numpy as np
from fastapi import HTTPException

import app as geometry


class ProductGeometryTests(unittest.TestCase):
    def test_white_background_cutout_keeps_product_and_removes_border(self):
        image = np.full((120, 90, 4), 255, dtype=np.uint8)
        image[25:105, 32:58, :3] = (90, 30, 10)
        cutout = geometry.crop_cutout(image)
        self.assertGreater(cutout.shape[0], 70)
        self.assertGreater(cutout.shape[1], 20)
        self.assertGreater(int(cutout[:, :, 3].max()), 250)

    def test_normalized_instance_box_is_resolved_per_source_image(self):
        box = geometry.instance_box({"bbox": {"x": 0.1, "y": 0.25, "width": 0.2, "height": 0.5}}, 1000, 1600)
        self.assertEqual(box, (100, 400, 200, 800))

    def test_target_ratio_comes_from_runtime_contract_not_fixture(self):
        cutout = np.zeros((100, 50, 4), dtype=np.uint8)
        cutout[:, :, 3] = 255
        self.assertAlmostEqual(geometry.target_front_aspect({"fixedLengthWidthHeightRatio": [2, 2, 13.5]}, cutout), 2 / 13.5)
        self.assertAlmostEqual(geometry.target_front_aspect({}, cutout), 0.5)

    def test_prepare_generates_one_target_placement_per_source_slot(self):
        source = np.full((600, 400, 4), 255, dtype=np.uint8)
        product = np.full((180, 70, 4), 255, dtype=np.uint8)
        product[10:170, 15:55, :3] = (30, 50, 90)

        async def fake_download(url):
            return source.copy() if "source" in url else product.copy()

        original_data_dir = geometry.DATA_DIR
        original_download = geometry.download_image
        with tempfile.TemporaryDirectory(prefix="product-geometry-test-") as temporary:
            geometry.DATA_DIR = Path(temporary).resolve()
            geometry.download_image = fake_download
            try:
                request = geometry.GeometryRequest(
                    jobId="job-global",
                    targetId="target-any",
                    sourceNodeKey="scene-any",
                    sourceImageUrl="https://example.com/source.png",
                    observedCount=1,
                    sourceInstances=[{
                        "id": "visible-source-1",
                        "bbox": {"x": 0.35, "y": 0.4, "width": 0.3, "height": 0.4},
                        "contactPoint": {"x": 0.5, "y": 0.8},
                        "occlusionOrder": 2
                    }],
                    target={"fixedLengthWidthHeightRatio": [2, 2, 13.5]},
                    productReferenceUrls=["https://example.com/target.png"]
                )
                result = asyncio.run(geometry.prepare_geometry(request))
            finally:
                geometry.DATA_DIR = original_data_dir
                geometry.download_image = original_download

        self.assertEqual(result["geometry"]["sourceInstanceCount"], 1)
        self.assertEqual(result["geometry"]["targetInstanceCount"], 1)
        self.assertEqual(result["geometry"]["placements"][0]["sourceInstanceId"], "visible-source-1")

    def test_prepare_rejects_missing_source_slots_instead_of_guessing(self):
        request = geometry.GeometryRequest(
            sourceNodeKey="scene-without-evidence",
            sourceImageUrl="https://example.com/source.png",
            productReferenceUrls=["https://example.com/target.png"]
        )
        with self.assertRaises(HTTPException) as raised:
            asyncio.run(geometry.prepare_geometry(request))
        self.assertEqual(raised.exception.detail["code"], "E_SOURCE_INSTANCE_MISSING")

    def test_count_conflict_returns_source_node_and_both_counts(self):
        request = geometry.GeometryRequest(
            sourceNodeKey="scene-count-conflict",
            sourceImageUrl="https://example.com/source.png",
            observedCount=2,
            sourceInstances=[{"id": "only-reliable-instance", "bbox": [0.2, 0.3, 0.2, 0.4]}],
            productReferenceUrls=["https://example.com/target.png"],
        )
        with self.assertRaises(HTTPException) as raised:
            asyncio.run(geometry.prepare_geometry(request))
        self.assertEqual(raised.exception.detail["code"], "E_COUNT_CONFLICT")
        self.assertEqual(raised.exception.detail["sourceNodeKey"], "scene-count-conflict")
        self.assertEqual(raised.exception.detail["observedCount"], 2)
        self.assertEqual(raised.exception.detail["reliableInstanceCount"], 1)


if __name__ == "__main__":
    unittest.main()
