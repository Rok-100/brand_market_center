"""Keep collector reads independent of write locks and durable retry receipts."""
from sql_gateway import repository_read

for method,args in [('get',['id']),('overview',[]),('delivery',['id']),('setting',['installedAt']),('rawQuery',['SELECT * FROM runs',[]])]:
    assert repository_read('intelligence',{'method':method,'args':args},None)
for method,args in [('setting',['installedAt','new']),('claim',[]),('finish',[]),('messageClaim',[0]),('messageFinish',[]),('rawQuery',['DELETE FROM runs',[]])]:
    assert not repository_read('intelligence',{'method':method,'args':args},None)
assert not repository_read('cloud_push',{'method':'get','args':[]},None)
assert repository_read('hub_documents',{'repository':'documents','method':'read'},None)
assert not repository_read('hub_documents',{'repository':'documents','method':'commit'},None)
print('Collector read/write classification: passed')
