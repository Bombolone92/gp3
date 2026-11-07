"""Original rotated screen controls separating font em, line advance and frame phase."""
from pathlib import Path
from copy import deepcopy
from zipfile import ZipFile, ZipInfo, ZIP_DEFLATED
import argparse, json, hashlib
from lxml import etree as E
from rotated_live_fixture import build as original

W='{http://schemas.openxmlformats.org/wordprocessingml/2006/main}'

def build():
    parts=original();root=E.fromstring(parts['word/document.xml']);body=root.find(W+'body')
    table=deepcopy(body.find(W+'tbl'));section=deepcopy(body[-1]);body.clear();cases=[]
    for font,size,rule,line in [('Arial',12,'auto',240),('Arial',10,'exact',237),('Courier New',10,'auto',240)]:
        for phase in [0,1]:
            p=E.SubElement(body,W+'p');pp=E.SubElement(p,W+'pPr')
            if cases:E.SubElement(pp,W+'pageBreakBefore')
            E.SubElement(E.SubElement(p,W+'r'),W+'t').text=f'{len(cases)+1}: {phase} twips'
            t=deepcopy(table);t.find(W+'tblPr/'+W+'tblInd').set(W+'w',str(phase))
            for node in t.iter(W+'rFonts'):
                for name in ['ascii','hAnsi','eastAsia','cs']:node.set(W+name,font)
            for node in t.iter(W+'sz'):node.set(W+'val',str(size*2))
            spacing=t.find('.//'+W+'spacing');spacing.set(W+'lineRule',rule);spacing.set(W+'line',str(line))
            body.append(t);cases.append(dict(page=len(cases)+1,font=font,size=size,lineRule=rule,lineTwips=line,phaseTwips=phase,direction='tbRl'))
    body.append(section);parts['word/document.xml']=E.tostring(root,xml_declaration=True,encoding='UTF-8',standalone=True)
    return parts,cases

def generate(folder):
    parts,cases=build();folder.mkdir(parents=True,exist_ok=True)
    with ZipFile(folder/'control.docx','w') as z:
        for name,data in parts.items():
            info=ZipInfo(name,(2026,10,3,0,0,0));info.compress_type=ZIP_DEFLATED;z.writestr(info,data)
    (folder/'cases.json').write_text(json.dumps(cases,indent=2)+'\n',encoding='utf8')
    print(hashlib.sha256((folder/'control.docx').read_bytes()).hexdigest())

if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('folder',type=Path);generate(parser.parse_args().folder)
