"""Batch the existing observer transaction without changing its notice policy."""
import json
from uuid import uuid4
from common import quote_identifier as q


def observe(db,specs,tasks,now,labels):
    tables={name:q(specs[name]['mysql']) for name in ['meta','observed','notices']}
    with db.cursor() as cursor:
        cursor.execute('SELECT 1 FROM '+tables['meta']+" WHERE `key`='baseline'")
        initialized=bool(cursor.fetchone())
        cursor.execute('SELECT `key`,status FROM '+tables['observed'])
        previous=dict(cursor.fetchall())
        updates=[];notices=[]
        for task in tasks:
            key=task['platform']+':'+task['id'];status=task['status']
            if previous.get(key)==status and key in previous:continue
            if initialized and status in labels:
                notices.append((uuid4().hex,json.dumps(task,ensure_ascii=False),status,now))
            updates.append((key,status));previous[key]=status
        for offset in range(0,len(notices),500):
            cursor.executemany('INSERT INTO '+tables['notices']+'(id,task,status,created_at) VALUES(%s,%s,%s,%s)',notices[offset:offset+500])
        for offset in range(0,len(updates),500):
            cursor.executemany('INSERT INTO '+tables['observed']+'(`key`,status) VALUES(%s,%s) ON DUPLICATE KEY UPDATE status=VALUES(status)',updates[offset:offset+500])
        cursor.execute('INSERT IGNORE INTO '+tables['meta']+"(`key`,value) VALUES('baseline',%s)",(str(now),))
    return len(notices)
