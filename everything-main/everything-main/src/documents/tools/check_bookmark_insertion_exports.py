"""Compare independent browser edits to literal bookmark positions saved by the reference application."""
from pathlib import Path
from zipfile import ZipFile
from xml.etree import ElementTree as E
import argparse,hashlib,json

ROOT=Path(__file__).resolve().parents[1]
W='http://schemas.openxmlformats.org/wordprocessingml/2006/main'
Q='{'+W+'}'
MODES=['append-row','middle-row','append-column','middle-column']
REFERENCE=json.loads((ROOT/'tests/fixtures/bookmark-insertion/native-ranges.json').read_text(encoding='utf-8'))
SOURCE=ROOT/'public/fixtures/bookmark-insertion.docx'

def markers(data):
    root=E.fromstring(data); text=[]; starts={}; ends={}; position=0
    def walk(node):
        nonlocal position
        if node.tag==Q+'bookmarkStart': starts[node.get(Q+'id')]=(node.get(Q+'name'),position)
        if node.tag==Q+'bookmarkEnd': ends[node.get(Q+'id')]=position
        if node.tag==Q+'t':
            value=node.text or '';text.append(value);position+=len(value.encode('utf-16-le'))//2
        for child in node: walk(child)
        if node.tag==Q+'p': text.append('\n');position+=1
    walk(root); text=''.join(text); encoded=text.encode('utf-16-le')
    assert set(starts)==set(ends)
    ranges={name:dict(start=start,end=ends[id],text=encoded[start*2:ends[id]*2].decode('utf-16-le')) for id,(name,start) in starts.items()}
    return root,text,ranges

def check_source():
    assert hashlib.sha256(SOURCE.read_bytes()).hexdigest()==REFERENCE['sourceSha256']
    with ZipFile(SOURCE) as archive: _,text,ranges=markers(archive.read('word/document.xml'))
    assert text==REFERENCE['cases']['original']['text'] and ranges==REFERENCE['cases']['original']['bookmarks']
    print('PASS independent source and reference marker provenance:',SOURCE)

def check_export(path,mode):
    with ZipFile(SOURCE) as original, ZipFile(path) as edited:
        assert set(original.namelist())==set(edited.namelist())
        for name in original.namelist():
            if name!='word/document.xml': assert original.read(name)==edited.read(name),(path,name)
        root,text,ranges=markers(edited.read('word/document.xml'))
    expected=REFERENCE['cases'][mode]
    assert text==expected['text'] and ranges==expected['bookmarks'],(path,ranges)
    table=root.find('.//'+Q+'tbl');rows=table.findall(Q+'tr')
    assert len(rows)==(3 if mode.endswith('row') else 2)
    assert all(len(row.findall(Q+'tc'))==(2 if mode.endswith('row') else 3) for row in rows)
    print('PASS reference marker ranges, inserted text, table structure and unchanged package parts:',path)

if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--check-fixtures',action='store_true')
    parser.add_argument('--check-exports',action='store_true')
    parser.add_argument('--exports-dir',type=Path,default=ROOT/'test-results')
    args=parser.parse_args()
    if args.check_fixtures: check_source()
    if args.check_exports:
        for mode in MODES:
            matches=list(args.exports_dir.rglob('bookmark-insertion-'+mode+'.docx'))
            assert matches,'Missing browser export: '+mode
            for path in matches: check_export(path,mode)
