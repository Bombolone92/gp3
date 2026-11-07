"""Original table label controls isolating height, spacing and nested context."""
import argparse
import json
from pathlib import Path
import tempfile
from xml.etree import ElementTree as E
from zipfile import ZipFile, ZipInfo, ZIP_DEFLATED
from table_prompt_metrics_fixture import generate as base_fixture

W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'
E.register_namespace('w', W)


def node(name, **attrs):
    return E.Element('{'+W+'}'+name, {'{'+W+'}'+key: str(value) for key, value in attrs.items()})


def add(parent, name, **attrs):
    child = node(name, **attrs)
    parent.append(child)
    return child


def paragraph(text='', label=False, explicit=False, cs_size=False):
    p = node('p')
    if label:
        pr = add(p, 'pPr'); add(pr, 'pStyle', val='Label')
        if explicit: add(pr, 'spacing', before=0, after=0, line=240, lineRule='auto')
        if cs_size: add(add(pr, 'rPr'), 'szCs', val=36)
    if text:
        r = add(p, 'r')
        if cs_size: add(add(r, 'rPr'), 'szCs', val=36)
        add(r, 't').text = text
    return p


def table(case):
    t = node('tbl'); pr = add(t, 'tblPr')
    if case['styled']: add(pr, 'tblStyle', val='Grid')
    add(pr, 'tblW', w=6300, type='dxa')
    borders = add(pr, 'tblBorders')
    for side in ['top', 'left', 'bottom', 'right', 'insideH', 'insideV']:
        add(borders, side, val='none' if case['styled'] else 'single', sz=0 if case['styled'] else 4)
    add(pr, 'tblLayout', type='fixed')
    if not case['styled']:
        margins = add(pr, 'tblCellMar')
        for side in ['top', 'left', 'bottom', 'right']: add(margins, side, w=0 if side in ['top', 'bottom'] else 108, type='dxa')
    grid = add(t, 'tblGrid'); add(grid, 'gridCol', w=900); add(grid, 'gridCol', w=5400)
    row = add(t, 'tr'); add(add(row, 'trPr'), 'trHeight', val=794, hRule=case['height'])
    for index, width in enumerate([900, 5400]):
        cell = add(row, 'tc'); cp = add(cell, 'tcPr'); add(cp, 'tcW', w=width, type='dxa')
        if case['styled']:
            cb = add(cp, 'tcBorders')
            for side in ['top', 'bottom']: add(cb, side, val='single', sz=4)
        cell.append(paragraph('W:' if index == 0 else '', label=index == 0, explicit=case['explicitSpacing'], cs_size=case['complexSize']))
    if not case['nested']: return t
    outer = node('tbl'); op = add(outer, 'tblPr'); add(op, 'tblStyle', val='Grid'); add(op, 'tblW', w=6700, type='dxa'); add(op, 'tblLayout', type='fixed')
    og = add(outer, 'tblGrid'); add(og, 'gridCol', w=6700)
    oc = add(add(outer, 'tr'), 'tc'); cp = add(oc, 'tcPr'); add(cp, 'tcW', w=6700, type='dxa')
    cb = add(cp, 'tcBorders')
    for side in ['top', 'left', 'bottom', 'right']: add(cb, side, val='nil' if side=='top' else 'single', **({} if side=='top' else {'sz':24}))
    cm = add(cp, 'tcMar')
    for side, value in [('top',113), ('left',115), ('bottom',432), ('right',115)]: add(cm, side, w=value, type='dxa')
    oc.append(paragraph('Context')); oc.append(t); oc.append(paragraph())
    return outer


def generate(root):
    root.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory() as directory:
        base_fixture(Path(directory))
        with ZipFile(Path(directory)/'control.docx') as source: parts={n:source.read(n) for n in source.namelist()}
    styles = E.fromstring(parts['word/styles.xml'])
    defaults = styles.find('.//{'+W+'}docDefaults/{'+W+'}rPrDefault/{'+W+'}rPr')
    defaults.find('{'+W+'}sz').set('{'+W+'}val','21'); defaults.find('{'+W+'}szCs').set('{'+W+'}val','21')
    fonts=defaults.find('{'+W+'}rFonts')
    fonts.set('{'+W+'}cs','Arial'); fonts.set('{'+W+'}eastAsia','Arial')
    add(defaults, 'lang', val='en-US', eastAsia='en-US', bidi='ar-SA')
    spacing = styles.find('.//{'+W+'}pPrDefault/{'+W+'}pPr/{'+W+'}spacing')
    styles.find('.//{'+W+'}pPrDefault/{'+W+'}pPr').remove(spacing)
    normal = add(styles,'style', type='table', default=1, styleId='TableNormal'); add(normal,'name',val='Normal Table')
    tp=add(normal,'tblPr'); add(tp,'tblInd',w=0,type='dxa'); margins=add(tp,'tblCellMar')
    for side in ['top','left','bottom','right']: add(margins,side,w=0 if side in ['top','bottom'] else 108,type='dxa')
    grid=add(styles,'style',type='table',styleId='Grid');add(grid,'name',val='Context Grid');add(grid,'basedOn',val='TableNormal');borders=add(add(grid,'tblPr'),'tblBorders')
    for side in ['top','left','bottom','right','insideH','insideV']:add(borders,side,val='single',sz=4)
    cases=[];document=node('document');body=add(document,'body')
    definitions=[('exact',True,False,False,False),('atLeast',True,False,False,False),('atLeast',False,False,False,False),('atLeast',False,True,False,False),('atLeast',False,True,True,False),('atLeast',False,True,True,True)]
    for i,(height,explicit,styled,nested,cs) in enumerate(definitions,1):
        case=dict(page=i,height=height,explicitSpacing=explicit,styled=styled,nested=nested,complexSize=cs);cases.append(case)
        title=paragraph('Case '+str(i))
        if i>1:title.insert(0,node('pPr'));add(title[0],'pageBreakBefore')
        body.append(title);body.append(table(case));body.append(paragraph())
    section=add(body,'sectPr');add(section,'pgSz',w=12240,h=15840);add(section,'pgMar',top=720,right=720,bottom=720,left=720,header=0,footer=0,gutter=0)
    parts['word/styles.xml']=E.tostring(styles,encoding='utf-8',xml_declaration=True);parts['word/document.xml']=E.tostring(document,encoding='utf-8',xml_declaration=True)
    with ZipFile(root/'control.docx','w',ZIP_DEFLATED) as output:
        for name, data in parts.items():
            info=ZipInfo(name,(2026,10,3,0,0,0));info.compress_type=ZIP_DEFLATED;output.writestr(info,data)
    (root/'cases.json').write_text(json.dumps(cases,indent=2)+'\n')
    print(root/'control.docx')


if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--output',type=Path,default=Path(__file__).resolve().parents[1]/'tests/fixtures/table-label-context');generate(parser.parse_args().output)
