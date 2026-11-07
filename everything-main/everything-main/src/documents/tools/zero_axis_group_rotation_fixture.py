"""Additional zero-axis controls: rotations/reflections below a collapsed axis."""
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED
from copy import deepcopy
import json
from lxml import etree as E

root = Path(__file__).resolve().parents[1]
folder = root / 'tests/fixtures/zero-axis-group-rotations'
folder.mkdir(parents=True, exist_ok=True)
ns = {'w':'http://schemas.openxmlformats.org/wordprocessingml/2006/main',
      'a':'http://schemas.openxmlformats.org/drawingml/2006/main',
      'wp':'http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing',
      'wpg':'http://schemas.microsoft.com/office/word/2010/wordprocessingGroup',
      'wps':'http://schemas.microsoft.com/office/word/2010/wordprocessingShape'}
with ZipFile(root / 'public/fixtures/zero-axis-groups.docx') as z:
    parts = {name:z.read(name) for name in z.namelist()}
doc = E.fromstring(parts['word/document.xml'])
paragraph = doc.find('.//w:p',ns)
original = paragraph.findall('w:r',ns)
for run in original[1:]: paragraph.remove(run)
paragraph.find('.//w:t',ns).text = 'Collapsed-axis rotation and reflection controls'
cases = []
for i, name in enumerate(['vertical-child-90','horizontal-child-90',
                          'vertical-child-45','horizontal-child-45',
                          'vertical-nested-90','horizontal-nested-90',
                          'vertical-flip-v','horizontal-flip-h',
                          'vertical-singular-flip-h','horizontal-singular-flip-v',
                          'vertical-singular-nested-flip-h','horizontal-singular-nested-flip-v']):
    vertical = i % 2 == 0
    run = deepcopy(original[1 if vertical else 2]); paragraph.append(run)
    anchor = run.find('.//wp:anchor',ns)
    x,y = 72+(i%3)*180, 72+(i//3)*160
    for axis,value in [('H',x),('V',y)]:
        anchor.find('wp:position'+axis+'/wp:posOffset',ns).text = str(value*12700)
    anchor.set('relativeHeight',str(i+1))
    prop=anchor.find('wp:docPr',ns); prop.set('id',str(i+1)); prop.set('name',name)
    group = anchor.find('.//wpg:wgp',ns)
    shape = group.find('wps:wsp',ns)
    if i >= 8:
        xf=group.find('wpg:grpSpPr/a:xfrm',ns)
        xf.set('flipH' if vertical else 'flipV','1')
        xf.find('a:chExt',ns).set('cx' if vertical else 'cy',str(36*12700))
        if i < 10:
            shape.find('wps:spPr/a:xfrm',ns).set('rot','1800000')
        else:
            nested=E.SubElement(group,'{'+ns['wpg']+'}grpSp')
            E.SubElement(nested,'{'+ns['wpg']+'}cNvGrpSpPr')
            props=deepcopy(group.find('wpg:grpSpPr',ns));nested.append(props)
            inner=props.find('a:xfrm',ns);inner.attrib.clear();inner.set('rot','1800000')
            inner.find('a:chExt',ns).set('cx' if vertical else 'cy','0')
            group.remove(shape);nested.append(shape)
    elif i < 4:
        shape.find('wps:spPr/a:xfrm',ns).set('rot',str((90 if i < 2 else 45)*60000))
    elif i < 6:
        nested=E.SubElement(group,'{'+ns['wpg']+'}grpSp')
        E.SubElement(nested,'{'+ns['wpg']+'}cNvGrpSpPr')
        props=deepcopy(group.find('wpg:grpSpPr',ns)); nested.append(props)
        props.find('a:xfrm',ns).set('rot','5400000')
        group.remove(shape); nested.append(shape)
    else:
        group.find('wpg:grpSpPr/a:xfrm',ns).set('flipV' if vertical else 'flipH','1')
    color=f'{180+i*5:02X}{32+i*4:02X}{48+i*5:02X}'
    shape.find('.//a:srgbClr',ns).set('val',color)
    cases.append(dict(name=name,x=x,y=y,color=color))
parts['word/document.xml']=E.tostring(doc,encoding='UTF-8',xml_declaration=True,standalone=True)
target=root/'public/fixtures/zero-axis-group-rotations.docx'
with ZipFile(target,'w',ZIP_DEFLATED) as z:
    for name,content in parts.items(): z.writestr(name,content)
(folder/'cases.json').write_text(json.dumps(cases,indent=2)+'\n',encoding='utf-8')
print(target)
