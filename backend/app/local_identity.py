"""External OA adapter. Business authorization still runs in auth/main."""
import os
from urllib.parse import urlsplit

PROFILES={
 'admin':{'number':'FD-990001','name':'本地管理员','role':'admin'},
 'manager':{'number':'FD-990002','name':'本地审核主管','role':'manager'},
 'member':{'number':'FD-990003','name':'本地创作成员','role':'member'},
 'denied':{'number':'FD-990004','name':'本地未授权成员','role':'denied'},
}
def user_for(role):
    p=PROFILES[role]
    return {'number':p['number'],'id':p['number'],'userId':p['number'],'username':p['number'],
      'realName':p['name'],'name':p['name'],'department':'品牌营销部','parentDept':'品牌营销部',
      'center':'AI营销中心','deptName':'AI营销中心','groupName':'本地创作组','status':'normal'}
def request_json(url,*,method='GET',payload=None,token=''):
    if os.getenv('LOCAL_DEV_MODE')!='1':raise RuntimeError('Local identity adapter disabled')
    path=urlsplit(url).path
    role=next((r for r in PROFILES if token=='local-dev-'+r),None)
    if path.endswith('/auth/userinfo'):
        return (200,{'code':0,'data':user_for(role)},{}) if role else (401,{'code':401,'message':'本地身份未登录'}, {})
    if path.endswith('/authentication/password-grant'):
        data=payload or {};name=str(data.get('username') or data.get('userName') or '').lower()
        role=next((r for r,p in PROFILES.items() if name in {r,p['number'].lower()}),None)
        if role and data.get('password')=='local-dev':return 200,{'code':0,'access_token':'local-dev-'+role},{}
        return 401,{'code':401,'message':'本地账号或密码错误'},{}
    if path.endswith('/authentication/captcha'):return 200,{'code':0,'message':'本地账号无需验证码'},{}
    return 503,{'code':503,'message':'此外部能力未配置本地适配器'},{}
