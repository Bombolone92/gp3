"""Independent header and multicolumn controls for percentage anchors."""
from copy import deepcopy
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED
from lxml import etree as E
from canvas_anchor_position_fixture import make, W, WP, R, CT
from percentage_anchor_fixture import WP14, MC

folder = Path(__file__).resolve().parents[1] / 'tests/fixtures/percentage-anchors'
parts = make(15)
original = E.fromstring(parts['word/document.xml'].encode())
example = original.find(f'{{{W}}}body/{{{W}}}p')
section = original.find(f'{{{W}}}body/{{{W}}}sectPr')

def paragraph(index, base, vertical, y):
    p = deepcopy(example)
    p.find(f'.//{{{W}}}t').text = f'Story anchor {index}'
    anchor = p.find(f'.//{{{WP}}}anchor')
    anchor.find(f'{{{WP}}}docPr').set('id',str(index))
    for axis, reference, value in [('H',base,50000),('V',vertical,y)]:
        pos=anchor.find(f'{{{WP}}}position{axis}');pos.clear();pos.set('relativeFrom',reference)
        E.SubElement(pos,f'{{{WP14}}}pctPos{axis}Offset').text=str(value)
    return p

def write(name, package, root):
    package['word/document.xml']=E.tostring(root,encoding='UTF-8',xml_declaration=True,standalone=True)
    with ZipFile(folder/f'{name}.docx','w',ZIP_DEFLATED) as z:
        for path,data in package.items():z.writestr(path,data)

def root():
    doc=E.Element(original.tag,nsmap={**original.nsmap,'wp14':WP14,'mc':MC})
    doc.set(f'{{{MC}}}Ignorable','wp14')
    return doc,E.SubElement(doc,f'{{{W}}}body')

doc,body=root()
body.append(paragraph(1,'column','page',25000))
p=E.SubElement(body,f'{{{W}}}p');E.SubElement(E.SubElement(p,f'{{{W}}}r'),f'{{{W}}}br',{f'{{{W}}}type':'column'})
body.append(paragraph(2,'column','page',50000))
sect=deepcopy(section);E.SubElement(sect,f'{{{W}}}cols',{f'{{{W}}}num':'2',f'{{{W}}}space':'720'})
body.append(sect);write('columns',dict(parts),doc)

doc,body=root()
E.SubElement(E.SubElement(E.SubElement(body,f'{{{W}}}p'),f'{{{W}}}r'),f'{{{W}}}t').text='Header percentage controls'
sect=deepcopy(section);sect.insert(0,E.Element(f'{{{W}}}headerReference',{f'{{{W}}}type':'default',f'{{{R}}}id':'header'}));body.append(sect)
header=E.Element(f'{{{W}}}hdr',nsmap=doc.nsmap);header.set(f'{{{MC}}}Ignorable','wp14')
header.extend([paragraph(1,'page','page',25000),paragraph(2,'margin','margin',50000),paragraph(3,'column','paragraph',75000)])
package=dict(parts)
package['word/header1.xml']=E.tostring(header,encoding='UTF-8',xml_declaration=True,standalone=True)
package['word/_rels/header1.xml.rels']=parts['word/_rels/document.xml.rels']
package['word/_rels/document.xml.rels']=parts['word/_rels/document.xml.rels'].replace('</Relationships>',f'<Relationship Id="header" Type="{R}/header" Target="header1.xml"/></Relationships>')
package['[Content_Types].xml']=parts['[Content_Types].xml'].replace('</Types>',f'<Override PartName="/word/header1.xml" ContentType="{CT}header+xml"/></Types>')
write('header',package,doc)

# Change header height independently of the physical margins. This distinguishes
# physical margin percentages from the writing span expanded by header text.
for p in header:
    pr=E.Element(f'{{{W}}}pPr');p.insert(0,pr)
    E.SubElement(pr,f'{{{W}}}spacing',{f'{{{W}}}line':'360',f'{{{W}}}lineRule':'exact',f'{{{W}}}before':'0',f'{{{W}}}after':'0'})
package['word/header1.xml']=E.tostring(header,encoding='UTF-8',xml_declaration=True,standalone=True)
write('header-exact',package,doc)
