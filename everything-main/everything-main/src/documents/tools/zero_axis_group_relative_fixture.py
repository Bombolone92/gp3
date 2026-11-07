"""Native controls for resizing a retained zero-axis group through wp14 percentages."""
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED
from copy import deepcopy
import json
from lxml import etree as E

root=Path(__file__).resolve().parents[1]
folder=root/'tests/fixtures/zero-axis-group-relative';folder.mkdir(parents=True,exist_ok=True)
ns={'w':'http://schemas.openxmlformats.org/wordprocessingml/2006/main',
    'a':'http://schemas.openxmlformats.org/drawingml/2006/main',
    'wp':'http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing',
    'wpg':'http://schemas.microsoft.com/office/word/2010/wordprocessingGroup',
    'wps':'http://schemas.microsoft.com/office/word/2010/wordprocessingShape',
    'wp14':'http://schemas.microsoft.com/office/word/2010/wordprocessingDrawing',
    'mc':'http://schemas.openxmlformats.org/markup-compatibility/2006'}
with ZipFile(root/'public/fixtures/zero-axis-groups.docx') as z:
    parts={name:z.read(name) for name in z.namelist()}
old=E.fromstring(parts['word/document.xml'])
doc=E.Element(old.tag,nsmap={**old.nsmap,'wp14':ns['wp14'],'mc':ns['mc']})
doc.attrib.update(old.attrib);doc.set('{'+ns['mc']+'}Ignorable','wp14')
for child in old:doc.append(child)
paragraph=doc.find('.//w:p',ns);runs=paragraph.findall('w:r',ns)
for run in runs[1:]:paragraph.remove(run)
paragraph.find('.//w:t',ns).text='Relative zero-axis group controls'
records=[]
for i,(name,axes) in enumerate([('vertical-resize','V'),('horizontal-resize','H'),
                               ('vertical-expand','H'),('horizontal-expand','V'),
                               ('vertical-both','HV'),('horizontal-both','HV')]):
    vertical=i%2==0
    x,y=90+(i%2)*240,90+(i//2)*230
    run=deepcopy(runs[1 if vertical else 2]);paragraph.append(run)
    anchor=run.find('.//wp:anchor',ns);anchor.set('relativeHeight',str(i+1))
    prop=anchor.find('wp:docPr',ns);prop.set('id',str(i+1));prop.set('name',name)
    for axis,value in [('H',x),('V',y)]:
        anchor.find('wp:position'+axis+'/wp:posOffset',ns).text=str(value*12700)
    for axis in axes:
        size=E.SubElement(anchor,'{'+ns['wp14']+'}sizeRel'+axis,relativeFrom='page')
        E.SubElement(size,'{'+ns['wp14']+'}pct'+('Width' if axis=='H' else 'Height')).text='25000'
    shape=anchor.find('.//wps:wsp',ns)
    shape.find('wps:spPr/a:xfrm/a:off',ns).set('x' if vertical else 'y',str(12*12700))
    color=f'{180+i*5:02X}{32+i*4:02X}{48+i*5:02X}'
    shape.find('.//a:srgbClr',ns).set('val',color)
    records.append(dict(name=name,x=x,y=y,color=color,relativeAxes=axes))
parts['word/document.xml']=E.tostring(doc,encoding='UTF-8',xml_declaration=True,standalone=True)
target=root/'public/fixtures/zero-axis-group-relative.docx'
with ZipFile(target,'w',ZIP_DEFLATED) as z:
    for name,content in parts.items():z.writestr(name,content)
(folder/'cases.json').write_text(json.dumps(records,indent=2)+'\n',encoding='utf-8')
print(target)
