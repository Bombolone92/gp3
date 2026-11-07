"""Original WordprocessingShape page-field controls with section restarts."""
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED
from copy import deepcopy
from lxml import etree as E
from canvas_group_fixture import NS, tag, add, shape
import json, argparse
parser=argparse.ArgumentParser(); parser.add_argument('--header',action='store_true'); parser.add_argument('--plain',action='store_true'); args=parser.parse_args()
name='shape-page-fields-header' if args.header else 'shape-page-fields-plain' if args.plain else 'shape-page-fields'
suffix='' if args.plain else ' \\* MERGEFORMAT'
ROOT = Path(__file__).resolve().parents[1]
folder = ROOT / 'tests/fixtures' / name
folder.mkdir(parents=True, exist_ok=True)
with ZipFile(ROOT / 'public/fixtures/dense-guides.docx') as z:
    parts = {n: z.read(n) for n in z.namelist()}
root = E.fromstring(parts['word/document.xml'])
body = root.find(tag('w:body'))
anchor_template = deepcopy(root.find('.//' + tag('wp:anchor')))
section = deepcopy(body.find(tag('w:sectPr')))
body.clear()
header=E.Element(tag('w:hdr'),nsmap=NS)
cases = [('PAGE', False, False), ('PAGE', True, False), ('PAGE', False, True), ('PAGE', True, True),
         ('NUMPAGES', False, False), ('NUMPAGES', True, True), ('SECTIONPAGES', False, False), ('SECTIONPAGES', True, True)]
def number_section(fmt, start):
    s = deepcopy(section)
    for n in list(s):
        if n.tag in [tag('w:pgNumType'), tag('w:type')]: s.remove(n)
    size = s.find(tag('w:pgSz')); size.set(tag('w:w'), '12240'); size.set(tag('w:h'), '15840')
    # pgNumType follows margins in the section schema.
    margins = s.find(tag('w:pgMar'))
    n = E.Element(tag('w:pgNumType')); n.set(tag('w:fmt'), fmt); n.set(tag('w:start'), str(start)); s.insert(list(s).index(margins)+1,n)
    if args.header:
        h=E.Element(tag('w:headerReference')); h.set(tag('w:type'),'default'); h.set(tag('r:id'),'rShapeHeader'); s.insert(0,h)
    return s
for page in range(3):
    host = add(body, 'w:p')
    pp = add(host, 'w:pPr')
    if page == 1: add(pp, 'w:pageBreakBefore')
    add(add(host, 'w:r'), 'w:t', text=f'Page field controls {page+1}')
    for i, (kind, simple, locked) in enumerate(cases if not args.header or page==0 else []):
        anchor = deepcopy(anchor_template)
        add(add(add(header if args.header else body, 'w:p'), 'w:r'), 'w:drawing').append(anchor)
        for axis, value in [('H', 72 + 250*(i%2)), ('V', 100 + 125*(i//2))]:
            pos = anchor.find(tag('wp:position'+axis)); pos.set('relativeFrom','page'); pos.find(tag('wp:posOffset')).text=str(value*12700)
        ext=anchor.find(tag('wp:extent')); ext.set('cx',str(200*12700)); ext.set('cy',str(80*12700))
        nv=anchor.find(tag('wp:docPr')); nv.set('id',str(page*8+i+1)); nv.set('name',f'P{page+1}F{i}')
        data=anchor.find('.//'+tag('a:graphicData')); data.clear(); data.set('uri',NS['wps'])
        s=shape(data,page*8+i+1,200*12700,80*12700,0,0,'EEEEEE',text=f'F{i}: ')
        p=s.find('.//'+tag('w:p')); run=p.find(tag('w:r'))
        rp=run.find(tag('w:rPr')); rp.find(tag('w:sz')).set(tag('w:val'),'40'); rp.find(tag('w:color')).set(tag('w:val'),'123456')
        add(rp,'w:rFonts',**{'w:ascii':'Arial','w:hAnsi':'Arial'})
        run.find(tag('w:t')).set('{http://www.w3.org/XML/1998/namespace}space','preserve')
        field_rp=deepcopy(rp)
        # Exercise capitalization on generated PAGE values, independently of labels.
        if i in (0,1):
            cap=E.Element(tag('w:caps' if i==0 else 'w:smallCaps'))
            field_rp.insert(0,cap)
        if simple:
            f=add(p,'w:fldSimple',**{'w:instr':f' {kind}{suffix} '})
            if locked: f.set(tag('w:fldLock'),'1')
            r=add(f,'w:r'); r.append(deepcopy(field_rp)); add(r,'w:t',text='99')
        else:
            begin=add(add(p,'w:r'),'w:fldChar',**{'w:fldCharType':'begin'})
            if locked: begin.set(tag('w:fldLock'),'1')
            code=add(p,'w:r')
            if args.plain and i==4:
                code_rp=add(code,'w:rPr'); add(code_rp,'w:rFonts',**{'w:ascii':'Arial','w:hAnsi':'Arial'}); add(code_rp,'w:sz',**{'w:val':'28'})
            add(code,'w:instrText',text=f' {kind}{suffix} ')
            add(add(p,'w:r'),'w:fldChar',**{'w:fldCharType':'separate'})
            r=add(p,'w:r'); r.append(deepcopy(field_rp)); add(r,'w:t',text='99')
            add(add(p,'w:r'),'w:fldChar',**{'w:fldCharType':'end'})
    if page == 1:
        p=add(body,'w:p'); add(p,'w:pPr').append(number_section('lowerRoman',3))
body.append(number_section('decimal',8))
parts['word/document.xml']=E.tostring(root,xml_declaration=True,encoding='UTF-8',standalone=True)
if args.header:
    parts['word/header-shapes.xml']=E.tostring(header,xml_declaration=True,encoding='UTF-8',standalone=True)
    ct=E.fromstring(parts['[Content_Types].xml']); E.SubElement(ct,'{http://schemas.openxmlformats.org/package/2006/content-types}Override',PartName='/word/header-shapes.xml',ContentType='application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml'); parts['[Content_Types].xml']=E.tostring(ct)
    relns='http://schemas.openxmlformats.org/package/2006/relationships'
    rel=E.fromstring(parts['word/_rels/document.xml.rels']) if 'word/_rels/document.xml.rels' in parts else E.Element('{'+relns+'}Relationships',nsmap={None:relns})
    E.SubElement(rel,'{'+relns+'}Relationship',Id='rShapeHeader',Type=NS['r']+'/header',Target='header-shapes.xml'); parts['word/_rels/document.xml.rels']=E.tostring(rel)
with ZipFile(ROOT/'public/fixtures'/(name+'.docx'),'w',ZIP_DEFLATED) as z:
    for n,data in parts.items(): z.writestr(n,data)
(folder/'cases.json').write_text(json.dumps([dict(id=f'F{i}',type=k,simple=s,locked=l) for i,(k,s,l) in enumerate(cases)],indent=2)+'\n')
