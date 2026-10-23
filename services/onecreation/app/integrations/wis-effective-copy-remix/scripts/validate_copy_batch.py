#!/usr/bin/env python3
"""Validate WIS second-creation copy batches without making business claims."""

from __future__ import annotations

import argparse
import json
import re
import sys
from collections import Counter
from pathlib import Path


REQUIRED_VARIANT_FIELDS = {
    "id",
    "tier",
    "template_id",
    "hook",
    "voiceover",
    "spoken_rhythm",
    "logic_map",
    "innovation",
    "evidence_shots",
    "evidence_sources",
    "risk_flags",
    "pending_fields",
}

OFFER_PATTERN = re.compile(
    r"(?:\d+(?:\.\d+)?|[一二两三四五六七八九十百]+)\s*(?:元|折|盒|片|罐|支|套|件)"
    r"|限时|限量|库存|最后一天|恢复原价|买[一二两三四五六七八九十\d]+发"
)

PLACEHOLDER_PATTERN = re.compile(r"\[待提供[:：][^\]]+\]|待人工确认|TODO|TBD", re.I)

CROSS_SKU_TERMS = {
    "wis-hydra-peptide-mask": {
        "微针",
        "富勒烯",
        "类蛇毒肽",
        "燕窝酸",
        "石墨烯",
        "专利微电流",
        "上眼皮",
        "月牙形眼贴",
    },
    "wis-crystal-firming-eye-mask": {
        "整脸膜布",
        "上千万微针",
        "黑色蜂窝膜布",
        "燕窝凝胶",
    },
}


def normalize_text(value: object) -> str:
    return re.sub(r"[\s，。！？、；：,.!?;:'\"“”‘’（）()《》【】\-_]", "", str(value or ""))


def bigrams(text: str) -> Counter[str]:
    value = normalize_text(text)
    if len(value) < 2:
        return Counter({value: 1}) if value else Counter()
    return Counter(value[index : index + 2] for index in range(len(value) - 1))


def dice_similarity(left: str, right: str) -> float:
    a = bigrams(left)
    b = bigrams(right)
    if not a and not b:
        return 1.0
    if not a or not b:
        return 0.0
    matches = sum((a & b).values())
    return (2.0 * matches) / (sum(a.values()) + sum(b.values()))


def add_error(errors: list[str], message: str) -> None:
    errors.append(f"ERROR: {message}")


def add_warning(warnings: list[str], message: str) -> None:
    warnings.append(f"WARN: {message}")


def validate(payload: dict) -> tuple[list[str], list[str]]:
    errors: list[str] = []
    warnings: list[str] = []
    sku_id = str(payload.get("sku_id") or "").strip()
    variants = payload.get("variants")

    if payload.get("schema_version") != "1.0":
        add_error(errors, "schema_version must be 1.0")
    if not sku_id:
        add_error(errors, "sku_id is required")
    if not isinstance(variants, list) or not variants:
        add_error(errors, "variants must be a non-empty array")
        return errors, warnings
    if payload.get("human_review_required") is not True:
        add_error(errors, "human_review_required must be true")

    seen_ids: set[str] = set()
    voices: list[tuple[str, str, str]] = []
    allowed_tiers = {"stable", "balanced", "bold"}
    forbidden = CROSS_SKU_TERMS.get(sku_id, set())
    offer_spoken = str(payload.get("offer_spoken") or "").strip()
    max_chars = int(payload.get("max_voiceover_chars") or 0)

    for index, variant in enumerate(variants, start=1):
        label = f"variant[{index}]"
        if not isinstance(variant, dict):
            add_error(errors, f"{label} must be an object")
            continue

        missing = sorted(REQUIRED_VARIANT_FIELDS - set(variant))
        if missing:
            add_error(errors, f"{label} missing fields: {', '.join(missing)}")

        variant_id = str(variant.get("id") or "").strip()
        if not variant_id:
            add_error(errors, f"{label}.id is empty")
        elif variant_id in seen_ids:
            add_error(errors, f"duplicate variant id: {variant_id}")
        seen_ids.add(variant_id)

        tier = str(variant.get("tier") or "").strip()
        if tier not in allowed_tiers:
            add_error(errors, f"{label}.tier must be stable, balanced, or bold")

        hook = str(variant.get("hook") or "").strip()
        voiceover = str(variant.get("voiceover") or "").strip()
        if not hook:
            add_error(errors, f"{label}.hook is empty")
        if not voiceover:
            add_error(errors, f"{label}.voiceover is empty")
        if hook and voiceover and normalize_text(hook) not in normalize_text(voiceover):
            add_warning(warnings, f"{label}.hook is not found verbatim in voiceover")
        if max_chars and len(normalize_text(voiceover)) > max_chars:
            add_error(errors, f"{label}.voiceover exceeds max_voiceover_chars={max_chars}")

        found_cross_sku = sorted(term for term in forbidden if term in voiceover)
        if found_cross_sku:
            add_error(errors, f"{label} contains cross-SKU terms: {', '.join(found_cross_sku)}")

        if not offer_spoken and OFFER_PATTERN.search(voiceover):
            add_error(errors, f"{label} contains price/quantity/urgency terms while offer_spoken is empty")
        if offer_spoken and offer_spoken not in voiceover:
            add_error(errors, f"{label} does not contain offer_spoken verbatim")

        pending_fields = variant.get("pending_fields")
        if PLACEHOLDER_PATTERN.search(voiceover) and not pending_fields:
            add_error(errors, f"{label} contains a placeholder but pending_fields is empty")

        for field_name in ("spoken_rhythm", "logic_map", "evidence_shots", "evidence_sources", "risk_flags", "pending_fields"):
            if not isinstance(variant.get(field_name), list):
                add_error(errors, f"{label}.{field_name} must be an array")

        if not variant.get("logic_map"):
            add_error(errors, f"{label}.logic_map must map the new copy to mother functions")
        if not variant.get("evidence_shots"):
            add_warning(warnings, f"{label}.evidence_shots is empty")
        if not str(variant.get("innovation") or "").strip():
            add_error(errors, f"{label}.innovation is empty")

        voices.append((variant_id or label, tier, voiceover))

    for left_index, (left_id, left_tier, left_text) in enumerate(voices):
        for right_id, right_tier, right_text in voices[left_index + 1 :]:
            similarity = dice_similarity(left_text, right_text)
            if similarity >= 0.88:
                add_error(errors, f"{left_id} and {right_id} are near-duplicates ({similarity:.0%})")
            elif similarity >= 0.76:
                add_warning(warnings, f"{left_id} and {right_id} are highly similar ({similarity:.0%})")
            if left_tier == "bold" and right_tier == "bold" and similarity >= 0.68:
                add_warning(warnings, f"bold variants {left_id} and {right_id} need clearer innovation ({similarity:.0%})")

    return errors, warnings


def main() -> int:
    parser = argparse.ArgumentParser(description="Validate a WIS second-creation copy JSON batch.")
    parser.add_argument("--input", required=True, help="Path to the JSON batch")
    args = parser.parse_args()

    path = Path(args.input)
    try:
        payload = json.loads(path.read_text(encoding="utf-8-sig"))
    except (OSError, json.JSONDecodeError) as error:
        print(f"ERROR: cannot read JSON: {error}", file=sys.stderr)
        return 2

    if not isinstance(payload, dict):
        print("ERROR: root value must be an object", file=sys.stderr)
        return 2

    errors, warnings = validate(payload)
    for message in warnings:
        print(message)
    for message in errors:
        print(message, file=sys.stderr)

    if errors:
        print(f"FAILED: {len(errors)} error(s), {len(warnings)} warning(s)", file=sys.stderr)
        return 1
    print(f"PASS: {len(payload.get('variants', []))} variant(s), {len(warnings)} warning(s)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
