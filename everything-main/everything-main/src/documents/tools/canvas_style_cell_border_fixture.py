"""Manual OPC/XML reference probe: ignored style tcBorders and long row page borders."""
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED
from xml.etree import ElementTree as E
from canvas_row_border_insets_fixture import build, W

def generate():
    path = Path(__file__).resolve().parents[1] / 'public/fixtures/style-cell-borders.docx'
    build([(False,16,0)], path)
    with ZipFile(path) as z: parts={n:z.read(n) for n in z.namelist()}
    doc=E.fromstring(parts['word/document.xml']); E.register_namespace('w',W)
    table=doc.find('.//{'+W+'}tbl'); rows=table.findall('{'+W+'}tr')
    E.SubElement(rows[0].find('{'+W+'}trPr'),'{'+W+'}tblHeader')
    for border in table.iter('{'+W+'}tcBorders'):
        for edge in border.findall('{'+W+'}bottom'): edge.set('{'+W+'}val','triple')
    cell=rows[1].find('{'+W+'}tc');cell.remove(cell.find('{'+W+'}p'))
    for i in range(80):
        p=E.SubElement(cell,'{'+W+'}p');r=E.SubElement(p,'{'+W+'}r');E.SubElement(r,'{'+W+'}t').text=f'Body{i:02}'
    size=doc.find('.//{'+W+'}pgSz'); size.set('{'+W+'}h','7200')
    pr=table.find(f'{{{W}}}tblPr')
    pr.insert(0,E.Element(f'{{{W}}}tblStyle',{f'{{{W}}}val':'ProbeStyle'}))
    styles=E.fromstring(parts['word/styles.xml'])
    style=E.SubElement(styles,f'{{{W}}}style',{f'{{{W}}}type':'table',f'{{{W}}}styleId':'ProbeStyle'})
    E.SubElement(style,f'{{{W}}}name',{f'{{{W}}}val':'Probe Style'})
    sp=E.SubElement(style,f'{{{W}}}tblPr'); borders=E.SubElement(sp,f'{{{W}}}tblBorders')
    E.SubElement(borders,f'{{{W}}}top',{f'{{{W}}}val':'double',f'{{{W}}}sz':'12',f'{{{W}}}color':'00AA00'})
    cp=E.SubElement(style,f'{{{W}}}tcPr'); borders=E.SubElement(cp,f'{{{W}}}tcBorders')
    E.SubElement(borders,f'{{{W}}}top',{f'{{{W}}}val':'single',f'{{{W}}}sz':'8',f'{{{W}}}color':'CC00CC'})
    borders=rows[0].find(f'.//{{{W}}}tcBorders')
    borders.insert(0,E.Element(f'{{{W}}}top',{f'{{{W}}}val':'dotDotDash',f'{{{W}}}sz':'12',f'{{{W}}}color':'0000FF'}))
    for col in table.find(f'{{{W}}}tblGrid'): col.set(f'{{{W}}}w','4680')
    for row in rows:
        cp=row.find(f'{{{W}}}tc/{{{W}}}tcPr')
        cp.remove(cp.find(f'{{{W}}}gridSpan')); cp.find(f'{{{W}}}tcW').set(f'{{{W}}}w','4680')
        cell=E.SubElement(row,f'{{{W}}}tc'); cp=E.SubElement(cell,f'{{{W}}}tcPr')
        E.SubElement(cp,f'{{{W}}}tcW',{f'{{{W}}}w':'4680',f'{{{W}}}type':'dxa'})
        p=E.SubElement(cell,f'{{{W}}}p'); run=E.SubElement(p,f'{{{W}}}r'); E.SubElement(run,f'{{{W}}}t').text='Neighbor'
    parts['word/document.xml']=E.tostring(doc,encoding='utf-8',xml_declaration=True)
    parts['word/styles.xml']=E.tostring(styles,encoding='utf-8',xml_declaration=True)
    with ZipFile(path,'w',ZIP_DEFLATED) as z:
        for name,data in parts.items(): z.writestr(name,data)
    print(path)

if __name__ == '__main__': generate()
