"""Original DrawingML system-color controls, authored as XML/OPC."""
from pathlib import Path
from zipfile import ZipFile,ZIP_DEFLATED
from copy import deepcopy
from lxml import etree as E

from canvas_group_fixture import NS,tag,add,shape
repo=Path(__file__).resolve().parents[1]
with ZipFile(repo/'public/fixtures/dense-guides.docx') as z:parts={n:z.read(n) for n in z.namelist()}
r=E.fromstring(parts['word/document.xml']);body=r.find(tag('w:body'));a=deepcopy(r.find('.//'+tag('wp:anchor')));sect=deepcopy(body.find(tag('w:sectPr')));body.clear();add(add(add(body,'w:p'),'w:r'),'w:t',text='System color controls')
for i,(token,cache) in enumerate([('scrollBar', None), ('background', None), ('activeCaption', None), ('inactiveCaption', None), ('menu', None), ('window', None), ('windowFrame', None), ('menuText', None), ('windowText', None), ('captionText', None), ('activeBorder', None), ('inactiveBorder', None), ('appWorkspace', None), ('highlight', None), ('highlightText', None), ('btnFace', None), ('btnShadow', None), ('grayText', None), ('btnText', None), ('inactiveCaptionText', None), ('btnHighlight', None), ('3dDkShadow', None), ('3dLight', None), ('infoText', None), ('infoBk', None), ('hotLight', None), ('gradientActiveCaption', None), ('gradientInactiveCaption', None), ('menuHighlight', None), ('menuBar', None), ('window','FF0000'), ('windowText','0000FF'), ('highlight','FF00FF'), ('btnFace','010203'), ('windowText','FF0000'), ('highlight',None)]):
 p=add(body,'w:p');add(add(p,'w:pPr'),'w:spacing',**{'w:line':'20','w:lineRule':'exact'});anchor=deepcopy(a);add(add(p,'w:r'),'w:drawing').append(anchor)
 for axis,value in [('H',36+90*(i%6)),('V',70+120*(i//6))]:
  n=anchor.find(tag('wp:position'+axis));n.set('relativeFrom','page');n.find(tag('wp:posOffset')).text=str(value*12700)
 ext=anchor.find(tag('wp:extent'));ext.set('cx',str(72*12700));ext.set('cy',str(72*12700));nv=anchor.find(tag('wp:docPr'));nv.set('id',str(i+1));nv.set('name',f'Control {i+1}')
 data=anchor.find('.//'+tag('a:graphicData'));data.clear();data.set('uri',NS['wps']);s=shape(data,i+1,72*12700,72*12700,0,0,'000000');fill=s.find('.//'+tag('a:solidFill'));fill.clear();color=add(fill,'a:sysClr',val=token)
 if cache:color.set('lastClr',cache)
 if i==34:add(color,'a:tint',val='50000')
 if i==35:add(color,'a:alpha',val='50000')
body.append(sect);parts['word/document.xml']=E.tostring(r,xml_declaration=True,encoding='UTF-8',standalone=True)
with ZipFile(repo/'public/fixtures/system-colors.docx','w',ZIP_DEFLATED) as z:
 for n,b in parts.items():z.writestr(n,b)
