"""Material hall reads: preserve legacy source footage, expose only new remixes."""
from collections import Counter
from datetime import datetime, timedelta
import inspect

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy import String, and_, cast, func, literal, or_, select, union_all

from .auth import require_user
from .database import get_db
from .models import Asset, AssetFavorite
from .remix_library import CATEGORIES, RemixAsset
from .remix_business import remix_scope
from .database import SessionLocal
from sqlalchemy import MetaData
RemixFavorite = AssetFavorite.__table__.to_metadata(MetaData(), name="py_cloud_remix_asset_favorites")


def build_hall_router(remix_out, source_out):
    from . import main
    def require_access(user=Depends(require_user)):
        main.require_module_access(user, "cloud-manager")
        return user

    router = APIRouter(prefix="/api/remix-library/hall", dependencies=[Depends(require_access)])

    def legacy(name, **args):
        function = getattr(main, name)
        accepted = inspect.signature(function).parameters
        return function(**{key: value for key, value in args.items() if key in accepted})

    def active(model):
        return [model.deleted_at.is_(None), model.purged_at.is_(None)]

    def new_facets(db):
        result = {"source": "新混剪素材库 · 用户上传", "directories": [], "folders": []}
        for field, name in [("category", "categories"), ("content_type", "content_types"),
                            ("status", "statuses"), ("ingest_source", "ingest_sources"),
                            ("library_type", "library_types"), ("asset_subtype", "asset_subtypes")]:
            column = getattr(RemixAsset, field)
            rows = dict(db.execute(select(column, func.count()).where(*active(RemixAsset)).group_by(column)).all())
            names = list(CATEGORIES) if field == "category" else list(rows)
            result[name] = [{"name": value, "count": rows.get(value, 0)} for value in names if value]
        tags = Counter()
        for values, count in db.execute(select(RemixAsset.tags, func.count()).where(*active(RemixAsset)).group_by(RemixAsset.tags)):
            tags.update({value: count for value in set(values or [])})
        result["tags"] = [{"name": tag, "count": count} for tag, count in tags.items()]
        return result

    def merge_facets(left, right):
        result = {"source": "视频素材 + 新混剪素材库"}
        for key in set(left) | set(right):
            if not isinstance(left.get(key, right.get(key)), list):
                continue
            values = Counter()
            for item in [*left.get(key, []), *right.get(key, [])]:
                values[item["name"]] += item["count"]
            result[key] = [{"name": name, "count": count} for name, count in values.items()]
        return result

    @router.get("/facets/bundle")
    def facets_bundle(db=Depends(get_db), user=Depends(require_user)):
        source = legacy("facets", library_type="source", asset_scope="marketing_video", db=db, user=user, _user=user, categories_only=False)
        source = dict(source)
        counts = {item["name"]:item["count"] for item in source["categories"]}
        source["categories"] = [{"name":name,"count":counts.get(name, 0)}
                                for name in dict.fromkeys([*counts, *CATEGORIES])]
        remix = new_facets(db)
        return {"source": source, "remix": remix, "all": merge_facets(source, remix)}

    @router.get("/facets")
    def facets(library_type: str = "", asset_scope: str = "", db=Depends(get_db), user=Depends(require_user)):
        if asset_scope == "product_image":
            return legacy("facets", library_type=library_type, asset_scope=asset_scope, db=db, user=user, _user=user)
        bundle = facets_bundle(db, user)
        return bundle.get(library_type or "all", bundle["all"])

    @router.get("/stats")
    def stats(db=Depends(get_db), user=Depends(require_user)):
        original = legacy("stats", db=db, user=user, _user=user)
        result = original.model_dump() if hasattr(original, "model_dump") else dict(original)
        old_where = [*active(Asset), Asset.library_type != "remix", main._recovery_asset_allowed(db, Asset.id, "visibility")]
        new_where = active(RemixAsset)

        def count(model, conditions, *extra):
            return db.scalar(select(func.count()).select_from(model).where(*conditions, *extra)) or 0

        old_count = count(Asset, old_where)
        new_count = count(RemixAsset, new_where)
        result.update(total=old_count + new_count, remix_outputs=new_count,
                      source_materials=count(Asset, old_where, Asset.asset_scope == "marketing_video"),
                      videos=count(Asset, old_where, Asset.media_type == "video") + new_count,
                      images=count(Asset, old_where, Asset.media_type == "image"),
                      source="视频素材 + 新混剪素材库 · 用户上传")
        result["oss_total"] = result["indexed_records"] = result["total"]
        result["trash"] = sum(count(model, [model.deleted_at.is_not(None), model.purged_at.is_(None)],
                                     *([] if main.is_asset_admin(user) else [model.uploaded_by_number == main.user_number(user)]),
                                     *([model.library_type != "remix"] if model is Asset else []))
                                  for model in [Asset, RemixAsset])
        result["favorites"] = db.scalar(select(func.count()).select_from(AssetFavorite).join(Asset, Asset.id == AssetFavorite.asset_id)
            .where(AssetFavorite.user_number == main.user_number(user), *active(Asset), Asset.library_type != "remix")) or 0
        result["favorites"] += db.scalar(select(func.count()).select_from(RemixFavorite).join(RemixAsset, RemixAsset.id == RemixFavorite.c.asset_id).where(RemixFavorite.c.user_number == main.user_number(user), *active(RemixAsset))) or 0
        result["new_this_week"] = sum(count(model, conditions, model.modified_at >= datetime.utcnow() - timedelta(days=7))
                                         for model, conditions in [(Asset, old_where), (RemixAsset, new_where)])
        result["storage_bytes"] = sum(db.scalar(select(func.sum(model.size)).where(*conditions)) or 0
                                        for model, conditions in [(Asset, old_where), (RemixAsset, new_where)])
        return result

    @router.get("/assets")
    def assets(request: Request, db=Depends(get_db), user=Depends(require_user), trashed: bool = False):
        p = request.query_params
        try:
            page, size = int(p.get("page", "1")), int(p.get("page_size", "24"))
        except ValueError:
            raise HTTPException(400, "分页参数无效")
        if page < 1 or not 1 <= size <= 100:
            raise HTTPException(400, "分页参数无效")
        if p.get("library_type", "") not in {"", "source", "remix"}:
            raise HTTPException(400, "素材库类型无效")
        favorites = main.favorite_asset_ids(db, user)
        with remix_scope(), SessionLocal() as business:
            remix_favorites = main.favorite_asset_ids(business, user)
        sort = p.get("sort", "newest")
        if sort not in {"newest", "oldest", "name", "size", "favorites", "gmv_desc", "gmv_asc"} and not (trashed and sort == "deleted"):
            raise HTTPException(400, "排序方式无效")
        gmv = main._asset_gmv_sort_subquery() if p.get("hot_only") == "true" or sort in {"gmv_desc", "gmv_asc"} else None
        columns = [column.key for column in Asset.__table__.columns]
        queries = []
        for model, namespace in [(Asset, "source"), (RemixAsset, "remix")]:
            conditions = [model.deleted_at.is_not(None), model.purged_at.is_(None)] if trashed else active(model)
            if trashed and not main.is_asset_admin(user):
                conditions.append(model.uploaded_by_number == main.user_number(user))
            if namespace == "source":
                conditions += [model.library_type != "remix", main._recovery_asset_allowed(db, model.id, "visibility")]
            if p.get("library_type") and p["library_type"] != namespace:
                continue
            for field in ["category", "media_type", "asset_scope", "asset_subtype", "content_type", "status", "ingest_source", "folder_name"]:
                if p.get(field):
                    conditions.append(getattr(model, field) == p[field])
            if p.get("q"):
                term = p["q"].strip()
                conditions.append(or_(*(column.contains(term, autoescape=True) for column in [
                    model.filename, model.category, model.uploaded_by_name, model.account_name, cast(model.tags, String)])))
            if p.get("tag"):
                conditions.append(cast(model.tags, String).contains(p["tag"], autoescape=True))
            if p.get("directory"):
                conditions.append(model.object_key.startswith(p["directory"]))
            if p.get("mine_only") == "true":
                conditions.append(or_(model.uploaded_by_number == main.user_number(user),
                    and_(model.uploaded_by_number == "", model.uploaded_by_name == main.user_name(user))))
            if p.get("favorite") in {"true", "false"}:
                personal = model.id.in_(favorites if namespace == "source" else remix_favorites)
                conditions.append(personal if p["favorite"] == "true" else ~personal)
            if p.get("effective_only") == "true":
                from .models import AssetEffectiveMark
                conditions.append(model.id.in_(select(AssetEffectiveMark.asset_id)) if namespace == "source" else literal(False))
            if p.get("hot_only") == "true":
                conditions.append(model.id.in_(select(gmv.c.asset_id).where(gmv.c.gmv_yuan > 50000))
                                  if namespace == "source" else literal(False))
            for key, end in [("upload_start_date", False), ("upload_end_date", True)]:
                if p.get(key):
                    try:
                        date = datetime.strptime(p[key], "%Y-%m-%d")
                    except ValueError:
                        raise HTTPException(400, "上传日期无效")
                    conditions.append(model.modified_at < date + timedelta(days=1) if end else model.modified_at >= date)
            fav = AssetFavorite.__table__ if namespace == "source" else RemixFavorite
            favorite_order = select(func.count()).select_from(fav).where(
                fav.c.asset_id == model.id).correlate(model).scalar_subquery() if sort == "favorites" else literal(0)
            gmv_order = select(gmv.c.gmv_yuan).where(gmv.c.asset_id == model.id).correlate(model).scalar_subquery() if namespace == "source" and gmv is not None else literal(None)
            queries.append(select(*(getattr(model, name).label(name) for name in columns),
                                  literal(namespace).label("asset_library"), favorite_order.label("_favorites"),
                                  gmv_order.label("_gmv")).where(*conditions))
        if not queries:
            return {"items": [], "total": 0, "page": page, "page_size": size, "source": "素材库"}
        table = (union_all(*queries) if len(queries) > 1 else queries[0]).subquery()
        total = db.scalar(select(func.count()).select_from(table)) or 0
        order = [table.c.modified_at.desc(), table.c.asset_library, table.c.id.desc()]
        if sort == "oldest":
            order = [table.c.modified_at.asc(), table.c.asset_library, table.c.id.asc()]
        if sort == "size":
            order = [table.c.size.desc(), *order]
        if sort == "name":
            order = [table.c.filename.asc(), *order]
        if sort == "favorites":
            order = [table.c._favorites.desc(), *order]
        if sort in {"gmv_desc", "gmv_asc"}:
            order = [table.c._gmv.is_(None).asc(), table.c._gmv.desc() if sort == "gmv_desc" else table.c._gmv.asc(), *order]
        if trashed:
            order = [table.c.deleted_at.desc(), *order]
        rows = db.execute(select(table).order_by(*order).offset((page - 1) * size).limit(size)).mappings().all()
        source_ids = [row["id"] for row in rows if row["asset_library"] == "source"]
        favorite_counts = main.favorite_counts_for_assets(db, source_ids)
        from .models import AssetEffectiveMark
        effective_marks = {item.asset_id: item for item in db.scalars(select(AssetEffectiveMark).where(AssetEffectiveMark.asset_id.in_(source_ids)))}
        reviews = main._review_latest_summaries(db, source_ids)
        gmv_summary = main._asset_gmv_summary(db, source_ids) if p.get("include_performance") != "false" else {}
        platform_gmv = main._asset_platform_gmv_summary(db, source_ids, gmv_summary) if p.get("include_performance") != "false" else {}
        remix_ids = [row["id"] for row in rows if row["asset_library"] == "remix"]
        with remix_scope(), SessionLocal() as business:
            remix_counts = main.favorite_counts_for_assets(business, remix_ids)
            remix_reviews = main._review_latest_summaries(business, remix_ids)
        items = []
        for row in rows:
            values = {key: row[key] for key in columns}
            if row["asset_library"] == "remix":
                item = RemixAsset()
                for key, value in values.items():
                    setattr(item, key, value)
                items.append(remix_out(item, request, {"favorite":item.id in remix_favorites,
                    "favorite_count":remix_counts.get(item.id, 0)}, remix_reviews.get(item.id, {})))
            else:
                item = Asset(**values)
                data = source_out(item, request, {"favorite": item.id in favorites,
                                                 "favorite_count": favorite_counts.get(item.id, 0)})
                preserved = main.to_asset_out(item, item.id in favorites, favorite_counts.get(item.id, 0),
                    can_manage=data["can_manage"], can_delete=data["can_delete"],
                    gmv_summary=gmv_summary.get(item.id), platform_gmv=platform_gmv.get(item.id),
                    effective_mark=effective_marks.get(item.id), review_summary=reviews.get(item.id)).model_dump()
                preserved.update({key: data[key] for key in ["preview_url", "download_url", "reference_video_url", "performance_screenshots"]})
                items.append({**preserved, "asset_library": "source"})
        return {"items": items, "total": total, "page": page, "page_size": size,
                "source": "视频素材 + 新混剪素材库"}

    @router.get("/trash")
    def trash(request: Request, db=Depends(get_db), user=Depends(require_user)):
        return assets(request, db, user, trashed=True)

    return router
