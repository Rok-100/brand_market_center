#!/usr/bin/env python3
"""Build and idempotently import the confirmed paid-KOC eye-mask cases."""

from __future__ import annotations

import argparse
import csv
import json
import re
import sys
import urllib.error
import urllib.request
from pathlib import Path


SCRIPT_TYPE = "付费KOC脚本"
PRODUCT = "眼膜"


def normalize_copy(value: str) -> str:
    return re.sub(r"\s+", "", value).strip()


def custom_cases(source_dir: Path) -> list[dict[str, str]]:
    path = source_dir / "眼膜脚本大合集【持更中】 - 达人定做脚本.csv"
    with path.open(encoding="utf-8-sig", newline="") as handle:
        rows = list(csv.reader(handle))

    headings: list[tuple[int, str]] = []
    for index, row in enumerate(rows):
        line = " ".join(cell.strip() for cell in row if cell.strip())
        match = re.match(r"^【\s*(.+?)\s*】脚本", line)
        if match:
            headings.append((index, match.group(1)))

    title_by_occurrence = {
        ("汤汤爱吃辣", 1): "汤汤爱吃辣｜付费KOC脚本｜眼膜",
        ("沐沐mu", 1): "沐沐Mu｜付费KOC脚本｜眼膜（01）",
        ("狮子发发", 1): "狮子发发｜付费KOC脚本｜眼膜",
        ("梁晓啦", 1): "梁晓啦｜付费KOC脚本｜眼膜",
        ("你好 Mary", 1): "你好 Mary｜付费KOC脚本｜眼膜",
        ("刘亿元", 1): "刘亿元｜付费KOC脚本｜眼膜",
        ("大王日记", 1): "大王日记｜付费KOC脚本｜眼膜",
        ("浩瀚菲菲", 1): "浩瀚菲菲｜付费KOC脚本｜眼膜",
        ("吴星星", 1): "吴星星｜付费KOC脚本｜眼膜",
        ("發發蔡（好物版）", 1): "發發蔡（好物版）｜付费KOC脚本｜眼膜",
        ("姣姣超爆", 1): "姣姣超爆｜付费KOC脚本｜眼膜",
        ("芊语宝宝", 1): "芊语宝宝｜付费KOC脚本｜眼膜（01）",
        ("Q酱", 1): "Q酱｜付费KOC脚本｜眼膜",
        ("沙沙好孕", 1): "沙沙好孕｜付费KOC脚本｜眼膜",
        ("小米锅巴", 1): "小米锅巴｜付费KOC脚本｜眼膜",
        ("小鱼儿同学", 1): "小鱼儿同学｜付费KOC脚本｜眼膜",
        ("沐沐Mu", 1): "沐沐Mu｜付费KOC脚本｜眼膜（02）",
        ("叮叮布丁", 1): "叮叮布丁｜付费KOC脚本｜眼膜",
        ("大橙橙(努力版)", 1): "大橙橙（努力版）｜付费KOC脚本｜眼膜",
        ("茉妈碎碎念(分享版)", 1): "茉妈碎碎念（分享版）｜付费KOC脚本｜眼膜",
        ("端子", 1): "端子｜付费KOC脚本｜眼膜",
        ("饭饭来财", 1): "饭饭来财｜付费KOC脚本｜眼膜",
        ("小陈陈.", 1): "小陈陈｜付费KOC脚本｜眼膜",
        ("江江的生活日记", 1): "江江的生活日记｜付费KOC脚本｜眼膜",
        ("芊语宝宝", 2): "芊语宝宝｜付费KOC脚本｜眼膜（02）",
    }
    skip_exact = {
        "台词",
        "场景：",
        "服装：",
        "妆容：",
        "颜色重",
        "敷一敷",
        "线条多",
        "无台词，只有动作，ASMR开头",
    }
    seen: dict[str, int] = {}
    cases: list[dict[str, str]] = []
    for position, (start, name) in enumerate(headings):
        end = headings[position + 1][0] if position + 1 < len(headings) else len(rows)
        seen[name] = seen.get(name, 0) + 1
        parts: list[str] = []
        for row in rows[start + 1 : end]:
            first = row[0].strip() if row else ""
            if not first or first in skip_exact or first.startswith(("场景：", "服装：", "妆容：")):
                continue
            parts.append(first)
        title = title_by_occurrence[(name, seen[name])]
        cases.append({"title": title, "copy": "\n".join(parts).strip()})
    return cases


def word_cases(extracted_dir: Path) -> list[dict[str, str]]:
    title_by_filename = {
        "WIS眼膜-爆款视频脚本1（如果你想给这里补水）.txt": "眼膜有效脚本1｜付费KOC脚本｜眼膜",
        "WIS眼膜-爆款视频脚本2（45岁秦海璐）.txt": "眼膜有效脚本2｜付费KOC脚本｜眼膜",
        "WIS眼膜-爆款视频脚本3（眼膜用的早看着就是比同龄人小）.txt": "眼膜有效脚本3｜付费KOC脚本｜眼膜",
        "WIS眼膜-爆款视频脚本4（睡前就这样敷上一片）.txt": "眼膜有效脚本4｜付费KOC脚本｜眼膜",
        "WIS眼膜-爆款视频脚本5（肖恩）.txt": "肖恩｜付费KOC脚本｜眼膜",
        "WIS眼膜—爆款视频脚本6（吾里七七）.txt": "吾里七七｜付费KOC脚本｜眼膜",
    }
    cases: list[dict[str, str]] = []
    for filename, title in title_by_filename.items():
        path = extracted_dir / filename
        parts: list[str] = []
        for line in path.read_text(encoding="utf-8").splitlines():
            if not re.match(r"^\d+ \|", line):
                continue
            columns = [cell.strip() for cell in line.split("|")]
            if len(columns) >= 6 and columns[5] and columns[5] != "纯音效":
                parts.append(columns[5])
        cases.append({"title": title, "copy": "\n".join(parts).strip()})
    return cases


def build_manifest(source_dir: Path, extracted_dir: Path) -> list[dict[str, object]]:
    cases = custom_cases(source_dir) + word_cases(extracted_dir)
    if len(cases) != 31:
        raise RuntimeError(f"Expected 31 cases, got {len(cases)}")
    titles = [str(item["title"]) for item in cases]
    if len(set(titles)) != len(titles):
        raise RuntimeError("Manifest contains duplicate titles")
    for item in cases:
        item.update({"scriptType": SCRIPT_TYPE, "product": PRODUCT, "status": "待验证"})
        if len(str(item["copy"]).strip()) < 8:
            raise RuntimeError(f"Copy is incomplete: {item['title']}")
    return cases


def request_json(url: str, method: str = "GET", payload: dict[str, object] | None = None) -> dict:
    data = json.dumps(payload, ensure_ascii=False).encode() if payload is not None else None
    request = urllib.request.Request(url, data=data, method=method)
    if data is not None:
        request.add_header("content-type", "application/json")
    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            return json.loads(response.read())
    except urllib.error.HTTPError as error:
        body = error.read().decode(errors="replace")
        raise RuntimeError(f"{method} {url}: HTTP {error.code}: {body}") from error


def import_cases(api_base: str, manifest: list[dict[str, object]]) -> dict[str, object]:
    current = request_json(f"{api_base.rstrip('/')}/api/cases").get("cases", [])
    by_title = {case["title"]: case for case in current}
    by_copy = {normalize_copy(case["copy"]): case for case in current}
    created: list[str] = []
    reused: list[str] = []

    for item in manifest:
        title = str(item["title"])
        copy = str(item["copy"])
        existing = by_title.get(title)
        if existing:
            if normalize_copy(existing["copy"]) != normalize_copy(copy):
                raise RuntimeError(f"Existing title has different copy: {title}")
            reused.append(title)
            continue

        same_copy = by_copy.get(normalize_copy(copy))
        if same_copy:
            case_id = same_copy["id"]
        else:
            created_case = request_json(
                f"{api_base.rstrip('/')}/api/cases",
                "POST",
                {"scriptType": SCRIPT_TYPE, "product": PRODUCT, "copy": copy, "videoUrls": []},
            )["case"]
            case_id = created_case["id"]

        updated = request_json(
            f"{api_base.rstrip('/')}/api/cases",
            "PATCH",
            {
                "id": case_id,
                "scriptType": SCRIPT_TYPE,
                "product": PRODUCT,
                "title": title,
                "copy": copy,
                "status": "待验证",
                "videoUrls": [],
            },
        )["case"]
        by_title[title] = updated
        by_copy[normalize_copy(copy)] = updated
        created.append(title)

    verified = request_json(f"{api_base.rstrip('/')}/api/cases").get("cases", [])
    verified_by_title = {case["title"]: case for case in verified}
    problems: list[str] = []
    for item in manifest:
        case = verified_by_title.get(item["title"])
        if not case:
            problems.append(f"missing: {item['title']}")
        elif case["scriptType"] != SCRIPT_TYPE or case["product"] != PRODUCT:
            problems.append(f"wrong category: {item['title']}")
        elif normalize_copy(case["copy"]) != normalize_copy(str(item["copy"])):
            problems.append(f"copy mismatch: {item['title']}")
    if problems:
        raise RuntimeError("Verification failed: " + "; ".join(problems))
    return {
        "manifestCount": len(manifest),
        "createdOrRetitled": len(created),
        "alreadyPresent": len(reused),
        "verified": len(manifest),
        "totalCasesNow": len(verified),
        "titles": [item["title"] for item in manifest],
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--source-dir", type=Path)
    parser.add_argument("--extracted-dir", type=Path)
    parser.add_argument("--manifest", type=Path)
    parser.add_argument("--api-base")
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()
    if args.manifest:
        manifest = json.loads(args.manifest.read_text(encoding="utf-8"))
    elif args.source_dir and args.extracted_dir:
        manifest = build_manifest(args.source_dir, args.extracted_dir)
    else:
        parser.error("provide --manifest or both --source-dir and --extracted-dir")
    if len(manifest) != 31:
        raise RuntimeError(f"Expected 31 cases, got {len(manifest)}")
    if args.output:
        args.output.write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")
    if args.api_base:
        print(json.dumps(import_cases(args.api_base, manifest), ensure_ascii=False, indent=2))
    else:
        print(json.dumps({"count": len(manifest), "titles": [item["title"] for item in manifest]}, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print(str(error), file=sys.stderr)
        raise
