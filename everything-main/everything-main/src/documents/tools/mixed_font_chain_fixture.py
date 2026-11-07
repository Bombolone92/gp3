"""Independent paragraph-chain controls, including mixed-size manual-break text."""
from pathlib import Path
from zipfile import ZipFile, ZipInfo, ZIP_DEFLATED
from lxml import etree as E
import json, hashlib, argparse
ROOT=Path(__file__).resolve().parents[1]
W='http://schemas.openxmlformats.org/wordprocessingml/2006/main';N='{'+W+'}'

def generate(destination):
    destination.mkdir(parents=True,exist_ok=True)
    with ZipFile(ROOT/'tests/fixtures/auto-line-spacing-rounding/control.docx') as z:
        parts={n:z.read(n) for n in z.namelist()}
    xml=E.fromstring(parts['word/document.xml']);body=xml.find(N+'body');sect=body.find(N+'sectPr')
    body.remove(sect);body.clear();cases=[]
    def props(parent,family,size):
        E.SubElement(parent,N+'rFonts',{N+'ascii':family,N+'hAnsi':family})
        E.SubElement(parent,N+'sz',{N+'val':str(size*2)})
    def paragraph(family,size,multiple,after=8,page_break=False):
        p=E.SubElement(body,N+'p');pr=E.SubElement(p,N+'pPr')
        if page_break:E.SubElement(pr,N+'pageBreakBefore')
        E.SubElement(pr,N+'spacing',{N+'before':'0',N+'after':str(after*20),N+'line':str(multiple),N+'lineRule':'auto'})
        props(E.SubElement(pr,N+'rPr'),family,size)
        return p
    def run(p,family,size,label):
        r=E.SubElement(p,N+'r');props(E.SubElement(r,N+'rPr'),family,size)
        E.SubElement(r,N+'t').text=label
        return r
    for family in ['Arial','Trebuchet MS','Times New Roman','Garamond']:
        for multiple in [240,259,276]:
            for empty_count in [0,5,12]:
                for mark_family in [family,'Garamond' if family!='Garamond' else 'Trebuchet MS']:
                    page=len(cases);labels=[];sizes=[]
                    run(paragraph(family,11,multiple,page_break=page>0),family,11,'Aa 00')
                    labels.append('Aa 00');sizes.append(11)
                    for _ in range(empty_count):paragraph(family,11,multiple)
                    title=paragraph(mark_family,12,multiple,after=30)
                    r=run(title,family,28,'Aa 01');E.SubElement(r,N+'br')
                    run(title,family,12,'Aa 02');run(title,family,11,'Aa 03')
                    labels.extend(['Aa 01','Aa 02','Aa 03']);sizes.extend([28,12,11])
                    for index in range(3):
                        p=paragraph(family,11,multiple)
                        r=run(p,family,11,f'Aa {4+index*2:02}');E.SubElement(r,N+'br')
                        E.SubElement(r,N+'t').text=f'Aa {5+index*2:02}'
                        labels.extend([f'Aa {4+index*2:02}',f'Aa {5+index*2:02}']);sizes.extend([11,11])
                    cases.append(dict(page=page,family=family,multiple=multiple,emptyCount=empty_count,markFamily=mark_family,labels=labels,sizes=sizes))
    body.append(sect);parts['word/document.xml']=E.tostring(xml,xml_declaration=True,encoding='UTF-8',standalone=True)
    with ZipFile(destination/'control.docx','w',ZIP_DEFLATED) as z:
        for name,data in parts.items():
            entry=ZipInfo(name,(2020,1,1,0,0,0));entry.compress_type=ZIP_DEFLATED;z.writestr(entry,data)
    (destination/'cases.json').write_text(json.dumps(cases,indent=2)+'\n',encoding='utf-8')
    print(hashlib.sha256((destination/'control.docx').read_bytes()).hexdigest())
    print('pages',len(cases),'paragraphs',sum(5+c['emptyCount'] for c in cases))

if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('destination',type=Path)
    generate(parser.parse_args().destination)
