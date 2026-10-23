"""Resolve existing permissions by verified OA employee number, not display name.

Never creates grants or infers permissions from fuzzy names. Callers must first
authenticate OA and enforce account status / confirmed-departure policy.
"""
import json

from fastapi import HTTPException
from sqlalchemy import func, or_, select

from .admission_policy import staff_number


def identity_identifiers(user: dict) -> list[str]:
    number = staff_number(user)
    name = str(user.get("realName") or user.get("name") or "").strip().casefold()
    ids = [f"number:{number}"] if number else []
    if name:
        ids.append(f"name:{name}")
        # The existing administrator form strips whitespace when saving names.
        compact_name = "".join(name.split())
        if compact_name != name:
            ids.append(f"name:{compact_name}")
    return ids


def _conflict() -> HTTPException:
    return HTTPException(403, {"code": "ACCESS_IDENTITY_CONFLICT",
        "message": "工号对应的授权记录有冲突，请联系权限管理员核对"})


def identity_grants(db, model, user: dict) -> list:
    """Return employee-bound rows first; exact legacy names only if unbound."""
    number = staff_number(user)
    identifiers = identity_identifiers(user)
    conditions = [model.identifier.in_(identifiers)]
    if number:
        compact_number = number.replace("-", "")
        conditions.extend([
            func.replace(func.upper(func.trim(model.user_number)), "-", "") == compact_number,
            model.identifier == f"number:{compact_number}",
        ])
    if not number and not identifiers:
        return []
    rows = db.scalars(select(model).where(or_(*conditions))).all()
    bound_rows, legacy_rows, invalid_names = [], [], []
    for row in rows:
        raw_number = str(getattr(row, "user_number", "") or "").strip()
        stored_number = staff_number({"number": raw_number})
        key_number = staff_number({"identifier": row.identifier})
        if raw_number and not stored_number:
            # An invalid binding must never degrade to a name-based permission.
            if row.identifier in identifiers:
                invalid_names.append(row)
            continue
        if key_number and stored_number and key_number != stored_number:
            raise _conflict()
        bound_number = stored_number or key_number
        if bound_number:
            if number and bound_number == number:
                bound_rows.append(row)
        elif row.identifier in identifiers:
            legacy_rows.append(row)
    if not bound_rows and invalid_names:
        raise _conflict()
    selected = bound_rows if bound_rows else legacy_rows
    return sorted(selected, key=lambda row: (
        row.identifier != f"number:{number}", row.identifier))


def admission_allowed(grants) -> bool:
    """Honor a later explicit re-grant; missing/tied decision times fail closed."""
    if not grants:
        return False
    if all(row.active for row in grants):
        return True
    if not any(row.active for row in grants):
        return False
    decisions = [(getattr(row, 'granted_at' if row.active else 'revoked_at', None),
                  bool(row.active)) for row in grants]
    if any(moment is None for moment, active in decisions):
        return False
    latest = max(moment for moment, active in decisions)
    return all(active for moment, active in decisions if moment == latest)


def unique_identity_grant(db, model, user: dict, policy_fields: tuple[str, ...]):
    """Do not silently widen scope when duplicate bindings disagree."""
    rows = identity_grants(db, model, user)
    if not rows:
        return None
    def policy(row):
        values = []
        for field in policy_fields:
            value = getattr(row, field, None)
            if isinstance(value, list):
                value = sorted(value)
            values.append(value)
        return json.dumps(values, sort_keys=True, ensure_ascii=False, default=str)
    if len({policy(row) for row in rows}) != 1:
        raise _conflict()
    return rows[0]


def bound_access_identifiers(db, access_model, user: dict) -> list[str]:
    """Use the same grant key for associated workspace profiles."""
    rows = identity_grants(db, access_model, user)
    if rows:
        return [row.identifier for row in rows]
    return identity_identifiers(user)
