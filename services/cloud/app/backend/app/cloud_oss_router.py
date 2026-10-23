"""Write new material to the requested bucket; retain existing OSS references."""
import time
from botocore.exceptions import ClientError

def missing(error):
    return isinstance(error,ClientError) and error.response.get('ResponseMetadata',{}).get('HTTPStatusCode')==404

class Paginator:
    def __init__(self,router):self.router=router
    def paginate(self,**kwargs):
        seen=set()
        for client,bucket in self.router.targets:
            for page in client.get_paginator('list_objects_v2').paginate(**{**kwargs,'Bucket':bucket}):
                contents=[item for item in page.get('Contents',[]) if item['Key'] not in seen]
                seen.update(item['Key'] for item in contents)
                yield {**page,'Contents':contents}

class RoutingClient:
    def __init__(self,primary,primary_bucket,legacy,legacy_bucket):
        self.targets=[(primary,primary_bucket),(legacy,legacy_bucket)];self.objects={};self.uploads={}
    def existing(self,key):
        cached=self.objects.get(key)
        if cached and time.monotonic()-cached[0]<300:return cached[1]
        for target in self.targets:
            try:target[0].head_object(Bucket=target[1],Key=key)
            except ClientError as error:
                if missing(error):continue
                raise
            self.objects[key]=(time.monotonic(),target);return target
        return self.targets[0]
    def multipart(self,key,upload):
        identity=(key,upload)
        if identity in self.uploads:return self.uploads[identity]
        for target in self.targets:
            try:target[0].list_parts(Bucket=target[1],Key=key,UploadId=upload,MaxParts=1)
            except ClientError as error:
                if missing(error):continue
                raise
            self.uploads[identity]=target;return target
        return self.targets[0]
    def generate_presigned_url(self,operation,Params,**kwargs):
        target=self.existing(Params['Key']) if operation in {'get_object','head_object'} else self.multipart(Params['Key'],Params['UploadId']) if 'UploadId' in Params else self.targets[0]
        return target[0].generate_presigned_url(operation,Params={**Params,'Bucket':target[1]},**kwargs)
    def get_paginator(self,operation):
        return Paginator(self) if operation=='list_objects_v2' else self.targets[0][0].get_paginator(operation)
    def __getattr__(self,operation):
        def call(**kwargs):
            key=kwargs.get('Key');upload=kwargs.get('UploadId')
            target=self.multipart(key,upload) if upload else self.existing(key) if operation in {'head_object','get_object','delete_object'} else self.targets[0]
            result=getattr(target[0],operation)(**{**kwargs,'Bucket':target[1]})
            if operation=='create_multipart_upload':self.uploads[(key,result['UploadId'])]=target
            if operation in {'put_object','complete_multipart_upload'}:self.objects[key]=(time.monotonic(),target)
            if operation=='delete_object':self.objects.pop(key,None)
            return result
        return call
