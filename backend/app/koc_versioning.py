"""Archive only the same creator's previous output of the same KOC task."""
from fastapi import HTTPException
from .models import Asset

def koc_previous_asset(provenance, db):
    previous_id = int(provenance.get("supersedes_asset_id") or 0)
    if provenance.get("workstation_type") != "koc" or not previous_id:
        return None
    asset = db.get(Asset, previous_id)
    if not asset or asset.purged_at is not None or asset.source != "ai_koc_workstation" or asset.uploaded_by_number != provenance.get("maker_id") or not provenance.get("source_url") or asset.reference_url != provenance["source_url"]:
        raise HTTPException(409, "只能更新当前制作人同一AI KOC任务的历史成片")
    return asset

def archive_koc_previous(previous, current, actor, db, audit):
    if not previous or previous.id == current.id:
        return
    previous.folder_name = "AI KOC历史版本"
    previous.status = "已替换"
    previous.tags = list(dict.fromkeys([*(previous.tags or []), "历史版本"]))[:30]
    audit(db, previous, "koc_superseded", actor_number=actor["number"], actor_name=actor["realName"], detail=f"已由完整成片{current.id}替换；保留原文件")
