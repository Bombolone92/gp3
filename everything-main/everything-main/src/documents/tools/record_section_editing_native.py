import argparse,hashlib,json
from pathlib import Path
from zipfile import ZipFile
from xml.etree import ElementTree as ET
W='{http://schemas.openxmlformats.org/wordprocessingml/2006/main}'
R='{http://schemas.openxmlformats.org/officeDocument/2006/relationships}'
parser=argparse.ArgumentParser(description='Record OOXML semantics from independently edited native section controls; no font programs inspected.')
parser.add_argument('--native-dir',required=True,type=Path)
parser.add_argument('--native-state',required=True,type=Path)
args=parser.parse_args()
root=Path(__file__).resolve().parents[1]
work=args.native_dir
native=json.loads(args.native_state.read_text(encoding='utf-8-sig'))
assert native['sourceSha256']==hashlib.sha256((root/'tests/fixtures/section-editing/formats.docx').read_bytes()).hexdigest(),'Wrong native source state'
def inspect(path, all_stories=False, cell_ownership=False):
    with ZipFile(path) as z:
        body=ET.fromstring(z.read('word/document.xml')).find(W+'body')
        rels={r.attrib['Id']:r.attrib['Target'] for r in ET.fromstring(z.read('word/_rels/document.xml.rels'))}
        inherited={}
        def section(n):
            size=n.find(W+'pgSz');margin=n.find(W+'pgMar')
            for kind in ['header','footer']:
                for h in n.findall(W+kind+'Reference'):inherited[(kind,h.attrib[W+'type'])]=rels[h.attrib[R+'id']]
            result={'width':int(size.attrib[W+'w'])/20,'height':int(size.attrib[W+'h'])/20,'left':int(margin.attrib[W+'left'])/20}
            if all_stories:result['firstPageDifferent']=n.find(W+'titlePg') is not None
            for kind,label,variant in [('header','header','default'),('header','headerFirst','first'),('header','headerEven','even'),('footer','footer','default'),('footer','footerFirst','first'),('footer','footerEven','even')]:
                if not all_stories and label!='header':continue
                target=inherited.get((kind,variant))
                result[label]=''.join(ET.fromstring(z.read('word/'+target)).itertext()) if target else ''
            return result
        rows=[];sections=[];parents={child:parent for parent in body.iter() for child in parent}
        for p in body.iter(W+'p'):
            jc=p.find(W+'pPr/'+W+'jc');sect=p.find(W+'pPr/'+W+'sectPr')
            rows.append({'text':''.join(n.text or '' for n in p.iter(W+'t')),'alignment':jc.attrib[W+'val'] if jc is not None else 'left','sectionEnd':sect is not None})
            if cell_ownership:
                ancestor=parents.get(p);in_cell=False
                while ancestor is not None:
                    in_cell=in_cell or ancestor.tag==W+'tc';ancestor=parents.get(ancestor)
                rows[-1]['inTable']=in_cell
            if sect is not None:sections.append(section(sect))
        sections.append(section(body.find(W+'sectPr')))
        return {'paragraphs':rows,'sections':sections,'tables':len(list(body.iter(W+'tbl')))}
results=[]
for fixture,names in [('formats',['delete-first','replace-first','replace-to-second','replace-both','multiline']),('table',['delete-first','replace-first','replace-to-second','replace-both']),('inheritance',['delete-first','replace-first','replace-to-second','replace-both','multiline']),('implicit-final',['delete-first','replace-first','replace-to-second','replace-both','multiline']),('boundary-table',['delete-first','replace-at-break','insert-text','replace-both','multiline-at-break'])]:
    source=root/f'tests/fixtures/section-editing/{fixture}.docx'
    owned=work/f'section-editing-{fixture}-native-20261005.docx'
    assert owned.read_bytes()==source.read_bytes(),'Owned native source changed'
    for name in names:
        path=work/f'section-editing-native-{"" if fixture=="formats" else fixture+"-"}{name}-20261005.docx'
        results.append({'fixture':fixture,'name':name,'sourceSha256':hashlib.sha256(source.read_bytes()).hexdigest(),'nativeExportSha256':hashlib.sha256(path.read_bytes()).hexdigest(),'expected':inspect(path,fixture in ['inheritance','implicit-final'],fixture=='boundary-table')})
result={'referenceBuild':native['referenceBuild'],'method':'Detached Range.Text on already-open visible independently authored controls; SaveAs2 to separate references, then Undo. Source bytes preserved. XML semantics only; no font programs or rendered glyphs inspected.','cases':results}
(root/'tests/fixtures/section-editing/reference.json').write_text(json.dumps(result,indent=2)+'\n')
print('Recorded',len(results),'native edit references')
