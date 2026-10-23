"""Synthetic account defaults for the isolated local simulation only."""
import os
from datetime import datetime
from uuid import NAMESPACE_URL, uuid5

from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.orm import Session

from .database import get_db
from .main import channels_accounts, require_user, user_name, user_number
from .models import ChannelsAccount


def build_local_channels_router():
    if os.getenv("LOCAL_SIMULATION") != "1":
        raise RuntimeError("Synthetic Channels accounts require LOCAL_SIMULATION=1")
    router = APIRouter()

    @router.get("/api/channels/accounts")
    def accounts(include_inactive: bool = False, db: Session = Depends(get_db),
                 user: dict = Depends(require_user)):
        owner = user_number(user)
        existing = db.scalar(select(ChannelsAccount).where(
            ChannelsAccount.owner_number == owner, ChannelsAccount.status == "active"))
        if existing is None:
            account_id = str(uuid5(NAMESPACE_URL, "local-simulation/channels/" + owner))
            account = db.get(ChannelsAccount, account_id)
            if account is None:
                account = ChannelsAccount(id=account_id, owner_number=owner)
                db.add(account)
            account.owner_name = user_name(user)
            account.nickname = "本地测试视频号"
            account.external_account_id = "local-simulation-" + owner
            account.status = "active"
            account.message = "本地模拟已登录"
            account.authorized_at = datetime.utcnow()
            db.commit()
        return channels_accounts(db=db, user=user)

    return router
