"""Original paired WML and DrawingML color-conversion controls; no renderer imports."""
from pathlib import Path
from zipfile import ZipFile,ZipInfo,ZIP_DEFLATED
from lxml import etree as E
import colorsys,json,sys,math
repo=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(repo/'tools'))
from canvas_group_fixture import NS,tag,add,shape
import argparse
parser=argparse.ArgumentParser(description=__doc__)
parser.add_argument('--output-dir',type=Path)
args=parser.parse_args()
out=args.output_dir or repo/'tests/fixtures/theme-conversion-stages';out.mkdir(parents=True,exist_ok=True)
cases=[c for c in json.loads((repo/'tests/fixtures/theme-color-precision/cases.json').read_text()) if c['value'] in [128,153,255]]
with ZipFile(repo/'public/fixtures/theme-color-precision.docx')as z:parts={n:z.read(n)for n in z.namelist()}
root=E.Element(tag('w:document'),nsmap={k:NS[k]for k in ['w','a','wp','wps']});body=add(root,'w:body')
for i,c in enumerate(cases):
 c['label']=f'C{i:03d}';c['page']=i//16;c['y']=50+(i%16)*34+10;c['swatches']=[]
 p=add(body,'w:p');pr=add(p,'w:pPr')
 if i and i%16==0:add(pr,'w:pageBreakBefore')
 add(pr,'w:spacing',**{'w:before':0,'w:after':0,'w:line':680,'w:lineRule':'exact'})
 r=add(p,'w:r');rp=add(r,'w:rPr');add(rp,'w:rFonts',**{'w:ascii':'Arial','w:hAnsi':'Arial'})
 add(rp,'w:color',**{'w:val':'112233','w:themeColor':c['theme'],'w:theme'+c['mode'].title():f'{c["value"]:02X}'})
 add(rp,'w:sz',**{'w:val':20});add(r,'w:t',text=c['label'])
 h,l,s=colorsys.rgb_to_hls(*(v/255 for v in bytes.fromhex(c['base'])))
 value=c['value']/255
 for j,kind in enumerate(['srgb-modifier','hsl-modifier','hsl-result']):
  x=180+j*130;y=c['y']-10;ident=i*3+j+1
  anchor=add(add(add(p,'w:r'),'w:drawing'),'wp:anchor',distT=0,distB=0,distL=0,distR=0,simplePos=0,relativeHeight=ident,behindDoc=0,locked=0,layoutInCell=1,allowOverlap=1)
  add(anchor,'wp:simplePos',x=0,y=0)
  for axis,pos in [('H',x),('V',y)]:add(add(anchor,'wp:position'+axis,relativeFrom='page'),'wp:posOffset',text=str(pos*12700))
  add(anchor,'wp:extent',cx=60*12700,cy=20*12700);add(anchor,'wp:effectExtent',l=0,t=0,r=0,b=0);add(anchor,'wp:wrapNone')
  add(anchor,'wp:docPr',id=ident,name=f'{c["label"]} {kind}');add(anchor,'wp:cNvGraphicFramePr')
  data=add(add(anchor,'a:graphic'),'a:graphicData',uri=NS['wps']);node=shape(data,ident,60*12700,20*12700,0,0,'000000')
  fill=node.find('.//'+tag('a:solidFill'));fill.clear()
  if kind=='srgb-modifier':color=add(fill,'a:srgbClr',val=c['base'])
  else:
   light=l if kind=='hsl-modifier' else l*value+(1-value if c['mode']=='tint' else 0)
   color=add(fill,'a:hslClr',hue=math.floor(h*21600000+.5),sat=math.floor(s*100000+.5),lum=math.floor(light*100000+.5))
  if kind!='hsl-result':
   add(color,'a:lumMod',val=math.floor(value*100000+.5))
   if c['mode']=='tint':add(color,'a:lumOff',val=math.floor((1-value)*100000+.5))
  c['swatches'].append(dict(kind=kind,x=x+30,y=c['y']))
sect=add(body,'w:sectPr');add(sect,'w:pgSz',**{'w:w':12240,'w:h':15840});add(sect,'w:pgMar',**{'w:top':720,'w:right':720,'w:bottom':720,'w:left':720,'w:header':0,'w:footer':0,'w:gutter':0})
parts['word/document.xml']=E.tostring(root,xml_declaration=True,encoding='UTF-8',standalone=True)
with ZipFile(out/'control.docx','w',ZIP_DEFLATED)as z:
 for name,data in parts.items():
  info=ZipInfo(name,(2026,9,28,16,0,0));info.create_system=0;info.external_attr=0o600<<16;z.writestr(info,data,compress_type=ZIP_DEFLATED)
(out/'cases.json').write_text(json.dumps(cases,indent=2)+'\n')
print('Generated',len(cases),'paired color controls')
