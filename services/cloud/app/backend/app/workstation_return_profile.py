"""Classify workstation outputs without declaring KOC content reviewed."""
def workstation_return_profile(provenance):
    koc = provenance.get("workstation_type") == "koc"
    if koc:
        return {
            "is_koc": True, "label": "AI KOC完整成片", "library_type": "source",
            "folder_name": "AI KOC", "source": "ai_koc_workstation", "asset_subtype": "AI原创素材",
            "tags": ("AI KOC", "完整成片"),
            "reference_url": str(provenance.get("source_url") or "")[:2048],
        }
    return {
        "is_koc": False, "label": "混剪成片", "library_type": "remix",
        "folder_name": "", "source": "wis_remix_workstation",
        "tags": ("二创混剪", "WIS混剪工作台", "审核通过"),
        "reference_url": f"wis-remix://render/{provenance.get('render_id', '')}/variant/{provenance.get('variant_id', '')}"[:2048],
    }
