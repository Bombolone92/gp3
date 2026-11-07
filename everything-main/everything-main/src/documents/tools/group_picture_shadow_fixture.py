"""Original grouped-picture shadow controls using the project's quadrant PNG."""
from pathlib import Path
from zipfile import ZipFile,ZIP_DEFLATED
from copy import deepcopy
from lxml import etree as E
from canvas_group_fixture import NS,tag,add
import json
root=Path(__file__).resolve().parents[1];folder=root/'tests/fixtures/group-picture-shadows';folder.mkdir(exist_ok=True)
with ZipFile(root/'public/fixtures/group-picture-flips.docx')as z:parts={n:z.read(n)for n in z.namelist()}
doc=E.fromstring(parts['word/document.xml']);body=doc.find(tag('w:body'));anchor=deepcopy(doc.find('.//'+tag('wp:anchor')));sect=deepcopy(body.find(tag('w:sectPr')));body.clear()
cases=[dict(name='no-shadow',none=True),dict(name='rectangle'),dict(name='ellipse-outline',ellipse=True,outline=True),dict(name='blurred',blur=4),dict(name='translucent',alpha=True),dict(name='crop-outset',crop=True),dict(name='rotated-fixed',rotation=30,rotate='0'),dict(name='rotated-with',rotation=30,rotate='1'),dict(name='flipped-fixed',flip=True,rotate='0'),dict(name='flipped-with',flip=True,rotate='1'),dict(name='group-rotated-fixed',groupRotation=30,rotate='0'),dict(name='group-rotated-with',groupRotation=30,rotate='1'),dict(name='ellipse-backing',ellipse=True,alpha=True,backing=True),dict(name='diagonal-hard',ellipse=True,outline=True,direction=45,distance=8)]
for i,c in enumerate(cases):
 p=add(body,'w:p')
 if i:add(add(p,'w:pPr'),'w:pageBreakBefore')
 add(add(p,'w:r'),'w:t',text=c['name']);a=deepcopy(anchor)
 for axis,value in [('H',120),('V',160)]:a.find(tag('wp:position'+axis)+'/'+tag('wp:posOffset')).text=str(value*12700)
 a.find(tag('wp:docPr')).set('id',str(i+1));a.find(tag('wp:docPr')).set('name',c['name'])
 pic=a.find('.//'+tag('pic:pic'));sp=pic.find(tag('pic:spPr'));xf=sp.find(tag('a:xfrm'))
 if c.get('ellipse'):sp.find(tag('a:prstGeom')).set('prst','ellipse')
 if c.get('rotation'):xf.set('rot',str(c['rotation']*60000))
 if c.get('flip'):xf.set('flipH','1')
 if c.get('groupRotation'):a.find('.//'+tag('wpg:grpSpPr')+'/'+tag('a:xfrm')).set('rot',str(c['groupRotation']*60000))
 if c.get('alpha'):add(pic.find(tag('pic:blipFill')+'/'+tag('a:blip')),'a:alphaModFix',amt=50000)
 if c.get('crop'):pic.find(tag('pic:blipFill')+'/'+tag('a:srcRect')).set('l','-50000')
 if c.get('backing'):add(add(sp,'a:solidFill'),'a:srgbClr',val='FFFFFF')
 if c.get('outline'):add(add(add(sp,'a:ln',w=25400),'a:solidFill'),'a:srgbClr',val='8040C0')
 if not c.get('none'):
  effect=add(sp,'a:effectLst');shadow=add(effect,'a:outerShdw',blurRad=c.get('blur',0)*12700,dist=c.get('distance',12)*12700,dir=c.get('direction',0)*60000,algn='tl',rotWithShape=c.get('rotate','0'));add(add(shadow,'a:srgbClr',val='000000'),'a:alpha',val=50000)
 add(add(add(body,'w:p'),'w:r'),'w:drawing').append(a)
body.append(sect);parts['word/document.xml']=E.tostring(doc,xml_declaration=True,encoding='UTF-8',standalone=True)
with ZipFile(folder/'control.docx','w',ZIP_DEFLATED)as z:
 for n,b in parts.items():z.writestr(n,b)
(folder/'cases.json').write_text(json.dumps(cases,indent=2)+'\n')
