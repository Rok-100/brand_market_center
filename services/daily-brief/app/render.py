"""Exact-data PNG posters using Pillow and locally installed Chinese fonts."""
from datetime import date,timedelta
from pathlib import Path
import math,os
from PIL import Image,ImageDraw,ImageFont
from report import build

INK='#173F49';MUTED='#628089';CORAL='#F17055';TEAL='#118F90';CREAM='#FCF9ED'
COLORS=['#5F59D8','#119E94','#E4853F','#B160A8','#4087B2']
FONT=os.getenv('REPORT_FONT',r'C:\Windows\Fonts\msyh.ttc')
BOLD=os.getenv('REPORT_FONT_BOLD',r'C:\Windows\Fonts\msyhbd.ttc')

def font(size,bold=False):return ImageFont.truetype(BOLD if bold else FONT,size)
def wan(c):return f'{c/1000000:,.1f}万'

class Canvas:
    def __init__(self,w,h):
        self.im=Image.new('RGB',(w,h),CREAM);self.d=ImageDraw.Draw(self.im)
    def text(self,xy,s,size=26,color=INK,bold=False,anchor=None):
        self.d.text(xy,str(s),font=font(size,bold),fill=color,anchor=anchor)
    def box(self,xy,fill='white',radius=24,outline=None):
        self.d.rounded_rectangle(xy,radius,fill=fill,outline=outline,width=2)
    def save(self,path):self.im.save(path,optimize=True)

def ranking(r,path,test=True):
    c=Canvas(1440,2400);d=c.d; top=r['rankings'][:15];q=r['quality']
    d.ellipse((1090,-230,1690,390),fill='#FFDEBB');d.ellipse((-190,2240,230,2660),fill='#D8EEEE')
    c.text((70,50),'WIS  /  MONTHLY PERFORMANCE',27,TEAL,True)
    c.text((70,112),'成员 GMV 排行榜',77,INK,True)
    c.text((73,224),f"{r['start']} — {r['target']}  ·  月度累计 TOP 15",31,MUTED)
    c.text((73,278),'千川 + 视频号  /  全部匹配成员',28,MUTED)
    status=('本地测试 · 数据待齐' if not r['ready'] else '本地测试') if test else '每日经营简报'
    c.box((1050,277,1368,329),'#FCE1D6',18);c.text((1209,303),status,24,CORAL,True,'mm')
    metrics=[('TOP 15 合计 GMV',wan(sum(x['gmvCents'] for x in top))),('榜单有效素材',f"{sum(x['materialCount'] for x in top):,}"),('已匹配成交成员',f"{len(r['rankings'])} 人")]
    for i,(label,value) in enumerate(metrics):
        x=70+i*444;c.box((x,366,x+414,536),outline='#DCE7E5')
        c.text((x+25,390),label,25,MUTED);c.text((x+25,439),value,49,CORAL,True)
    c.text((86,580),'排名 / 姓名 · 所属部门',25,MUTED)
    c.text((650,580),'GMV 进度',25,MUTED)
    c.text((1124,580),'GMV',25,MUTED,anchor='ra')
    c.text((1334,580),'有效素材',25,MUTED,anchor='ra')
    maximum=max((x['gmvCents'] for x in top),default=1)
    if not top:c.text((720,900),'当前暂无可归属的成交数据',35,MUTED,anchor='mm')
    for i,item in enumerate(top):
        y=635+i*105
        c.box((70,y,1370,y+92),'#FFF5DC' if i<3 else '#FFFFFF',18,'#E1EAE6')
        c.box((91,y+20,144,y+73),'#F8D9A9' if i<3 else '#EDF4F1',26)
        c.text((117,y+47),i+1,28,INK,True,'mm')
        c.text((173,y+8),item['name'],32,INK,True)
        c.text((173,y+52),item['department'],20,MUTED)
        c.box((634,y+36,955,y+57),'#E6EFEB',10)
        width=max(6,int(321*item['gmvCents']/maximum))
        c.box((634,y+36,634+width,y+57),CORAL if i<3 else TEAL,10)
        c.text((1140,y+44),wan(item['gmvCents']),35,CORAL,True,'rm')
        c.text((1327,y+44),f"{item['materialCount']:,}",32,INK,True,'rm')
    y=2250;coverage=q.get('mappedCents',0)/max(q['totalCents'],1)
    c.box((70,y,1370,y+108),'#E8F3EE',18)
    c.text((95,y+19),f"GMV 归属覆盖率 {coverage:.1%}    ·    未匹配 {wan(q.get('unmappedCents',0))}    ·    冲突 {wan(q.get('conflictCents',0))}",25,INK,True)
    c.text((95,y+62),'归属：实际作者优先，其次素材关键词；冲突和未匹配金额不进入个人榜单。',23,MUTED)
    c.save(path)

def trend(r,path,test=True):
    c=Canvas(1800,1415);d=c.d;products=r['products'][:5]
    dates=[str(date.fromisoformat(r['trendStart'])+timedelta(days=i)) for i in range(15)]
    quality=r['trendQuality'];total=quality['totalCount'];top=sum(x['totalCount'] for x in products)
    def count(value):return '缺数' if value is None else f'{value:,}条'
    c.text((70,45),'WIS  /  MATERIAL LAUNCHES',26,TEAL,True)
    c.text((70,103),'近 15 天单品素材上线趋势',57,INK,True)
    c.text((73,191),f"{r['trendStart']} — {r['target']}  ·  素材过程同口径  ·  上线数量 TOP 5",29,MUTED)
    if test:c.text((1730,60),'本地测试',24,CORAL,True,'ra')
    c.box((70,253,1730,364),'#E8F3EE',20)
    for x,label,value in [(100,'可核验上线素材',count(total)),(670,'Top 5 / 已归属',f"{top/max(quality['mappedCount'],1):.1%}"),(1250,'有上线单品',f"{len(r['products'])} 个")]:
        c.text((x,274),label,23,MUTED);c.text((x+250,280),value,36,INK,True)
    x0,x1,y0,y1=146,1700,480,1082
    peak=max((v for p in products for v in p['days'].values()),default=1)
    step=max(1,10**math.floor(math.log10(max(peak/5,1))))
    step=max(1,math.ceil(peak/5/step)*step);upper=max(step,math.ceil(peak/step)*step)
    c.text((85,414),'每日上线数量 / 条',23,MUTED)
    if not products:c.text((900,710),'当前暂无可用的单品上线数据',35,MUTED,anchor='mm')
    for k in range(int(upper/step)+1):
        val=k*step;y=y1-(y1-y0)*val/max(upper,1)
        d.line((x0,y,x1,y),fill='#DDE5E1',width=2);c.text((x0-20,y),f'{val:g}',23,MUTED,anchor='rm')
    for i,day in enumerate(dates):
        x=x0+i*(x1-x0)/14;c.text((x,y1+23),day[5:].replace('-','/'),22,MUTED,anchor='ma')
    series=[]
    for n,p in enumerate(products):
        points=[None if day not in p['days'] else (x0+i*(x1-x0)/14,y1-(y1-y0)*p['days'][day]/max(upper,1)) for i,day in enumerate(dates)]
        series.append(points)
        for before,after in zip(points,points[1:]):
            if before is not None and after is not None:d.line([before,after],fill=COLORS[n],width=5)
        for point in points:
            if point is not None:
                x,y=point;d.ellipse((x-5,y-5,x+5,y+5),fill=COLORS[n],outline='white',width=2)
        left=70+n*336;c.box((left,1173,left+314,1371),'white',18,'#E1EAE6')
        d.ellipse((left+20,1194,left+32,1206),fill=COLORS[n])
        c.text((left+45,1183),p['name'],23,INK,True)
        c.text((left+22,1238),'15 天累计',22,MUTED);c.text((left+290,1233),count(p['totalCount']),28,COLORS[n],True,'ra')
        c.text((left+22,1284),'昨日',22,MUTED);c.text((left+290,1281),count(p['days'].get(r['target'])),27,INK,True,'ra')
        peakday=max(p['days'],key=p['days'].get)
        c.text((left+22,1330),f"峰值 {peakday[5:]}  {count(p['days'][peakday])}",21,MUTED)
    # Lay out all five labels for each date together so close values remain readable.
    # Draw labels last, with leaders where a label has moved away from its node.
    for i,day in enumerate(dates):
        labels=sorted([{'series':n,'x':points[i][0],'pointY':points[i][1],
                        'y':points[i][1]-20,'text':str(products[n]['days'][day])}
                       for n,points in enumerate(series) if points[i] is not None],key=lambda a:a['y'])
        for j,label in enumerate(labels):
            label['y']=max(label['y'],y0-15 if j==0 else labels[j-1]['y']+29)
        if labels and labels[-1]['y']>y1-15:
            labels[-1]['y']=y1-15
            for j in range(len(labels)-2,-1,-1):
                labels[j]['y']=min(labels[j]['y'],labels[j+1]['y']-29)
        for label in labels:
            x,y=label['x']+(34 if i==0 else 0),label['y'];color=COLORS[label['series']]
            if abs(label['pointY']-y)>27 or i==0:
                d.line((label['x'],label['pointY']-7,x,y+12),fill=color,width=1)
            d.text((x,y),label['text'],font=font(21,True),fill=color,anchor='mm',
                   stroke_width=3,stroke_fill=CREAM)
    c.save(path)

if __name__=='__main__':
    import sys
    r,out=build(date.fromisoformat(sys.argv[1]));ranking(r,out/'ranking.png');trend(r,out/'trend.png')
    print(out)
