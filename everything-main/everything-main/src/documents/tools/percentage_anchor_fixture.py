"""Original percentage-position controls built from our authored OPC shell."""
from copy import deepcopy
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED
from lxml import etree as E
from canvas_anchor_position_fixture import make, W, WP

ROOT=Path(__file__).resolve().parents[1]
WP14='http://schemas.microsoft.com/office/word/2010/wordprocessingDrawing'
MC='http://schemas.openxmlformats.org/markup-compatibility/2006'
CASES=[
    ('page','page',25000,50000), ('margin','margin',25000,50000),
    ('column','paragraph',25000,50000), ('page','page',-5000,10000),
    ('page','page',95000,95000), ('page','topMargin',25000,50000),
    ('page','bottomMargin',25000,50000), ('column','line',25000,50000),
    ('page','page',25000,50000), ('margin','margin',25000,50000),
    ('page','page',25000,'914400'), ('page','page','914400',50000),
    ('page','page','25%','50%'), ('page','page',25000,50000),
]
def generate():
    parts=make(15)
    old=E.fromstring(parts['word/document.xml'].encode())
    root=E.Element(old.tag,nsmap={**old.nsmap,'wp14':WP14,'mc':MC})
    root.set(f'{{{MC}}}Ignorable','wp14')
    body=E.SubElement(root,f'{{{W}}}body')
    example=old.find(f'{{{W}}}body/{{{W}}}p')
    for i,(h,v,x,y) in enumerate(CASES):
        p=deepcopy(example)
        pr=E.Element(f'{{{W}}}pPr');p.insert(0,pr)
        if i:E.SubElement(pr,f'{{{W}}}pageBreakBefore')
        E.SubElement(pr,f'{{{W}}}spacing',{f'{{{W}}}line':'360',f'{{{W}}}lineRule':'exact',f'{{{W}}}before':'0',f'{{{W}}}after':'0'})
        p.find(f'.//{{{W}}}t').text=f'Percentage {i+1}: {h}/{v}'
        anchor=p.find(f'.//{{{WP}}}anchor');anchor.set('relativeHeight',str(i))
        anchor.find(f'{{{WP}}}docPr').set('id',str(i+1))
        for axis,base,value in [('H',h,x),('V',v,y)]:
            pos=anchor.find(f'{{{WP}}}position{axis}');pos.clear();pos.set('relativeFrom',base)
            target=pos
            if i==13:
                ac=E.SubElement(pos,f'{{{MC}}}AlternateContent');target=E.SubElement(ac,f'{{{MC}}}Choice',Requires='wp14')
                fallback=E.SubElement(ac,f'{{{MC}}}Fallback');E.SubElement(fallback,f'{{{WP}}}posOffset').text='0'
            E.SubElement(target,f'{{{WP}}}posOffset' if isinstance(value,str) and not value.endswith('%') else f'{{{WP14}}}pctPos{axis}Offset').text=str(value)
        if i>=8:
            anchor.insert(list(anchor).index(anchor.find(f'{{{WP}}}extent'))+1,E.Element(f'{{{WP}}}effectExtent',l='63500',t='88900',r='139700',b='165100'))
        body.append(p)
    body.append(deepcopy(old.find(f'{{{W}}}body/{{{W}}}sectPr')))
    parts['word/document.xml']=E.tostring(root,xml_declaration=True,encoding='UTF-8',standalone=True)
    folder=ROOT/'tests/fixtures/percentage-anchors';folder.mkdir(parents=True,exist_ok=True)
    with ZipFile(folder/'body.docx','w',ZIP_DEFLATED) as z:
        for name,data in parts.items():z.writestr(name,data)
    print(folder/'body.docx')
    cellroot=deepcopy(root);cellbody=cellroot.find(f'{{{W}}}body')
    for p in list(cellbody.findall(f'{{{W}}}p')):
        pr=p.find(f'{{{W}}}pPr');pagebreak=pr.find(f'{{{W}}}pageBreakBefore')
        if pagebreak is not None:
            pr.remove(pagebreak)
            breaker=E.Element(f'{{{W}}}p');E.SubElement(E.SubElement(breaker,f'{{{W}}}r'),f'{{{W}}}br',{f'{{{W}}}type':'page'})
            cellbody.insert(list(cellbody).index(p),breaker)
        table=E.Element(f'{{{W}}}tbl');tp=E.SubElement(table,f'{{{W}}}tblPr')
        E.SubElement(tp,f'{{{W}}}tblW',{f'{{{W}}}w':'4800',f'{{{W}}}type':'dxa'})
        E.SubElement(tp,f'{{{W}}}tblLayout',{f'{{{W}}}type':'fixed'})
        margins=E.SubElement(tp,f'{{{W}}}tblCellMar')
        for side in ['top','left','bottom','right']:E.SubElement(margins,f'{{{W}}}{side}',{f'{{{W}}}w':'200',f'{{{W}}}type':'dxa'})
        E.SubElement(E.SubElement(table,f'{{{W}}}tblGrid'),f'{{{W}}}gridCol',{f'{{{W}}}w':'4800'})
        cell=E.SubElement(E.SubElement(table,f'{{{W}}}tr'),f'{{{W}}}tc');E.SubElement(E.SubElement(cell,f'{{{W}}}tcPr'),f'{{{W}}}tcW',{f'{{{W}}}w':'4800',f'{{{W}}}type':'dxa'})
        cellbody.insert(list(cellbody).index(p),table);cell.append(p)
    parts['word/document.xml']=E.tostring(cellroot,xml_declaration=True,encoding='UTF-8',standalone=True)
    with ZipFile(folder/'cell.docx','w',ZIP_DEFLATED) as z:
        for name,data in parts.items():z.writestr(name,data)
if __name__=='__main__':generate()
