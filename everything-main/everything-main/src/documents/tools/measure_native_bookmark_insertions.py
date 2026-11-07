"""Extract literal reference-serialized marker ranges, distinct from the reference table selection API."""
from pathlib import Path
from lxml import etree as E
import argparse,hashlib,json
parser=argparse.ArgumentParser(description=__doc__)
parser.add_argument('word_dir',type=Path)
parser.add_argument('--output',type=Path,required=True)
args=parser.parse_args()
work=args.word_dir
root=Path(__file__).resolve().parents[1]
W='http://schemas.openxmlformats.org/wordprocessingml/2006/main'
P='http://schemas.microsoft.com/office/2006/xmlPackage'
q=lambda name:'{'+W+'}'+name
names={'WholeTable','WholeBodyTable','BeforeRows','AfterRows','BetweenRows','BetweenCells','RowOne','RowTwo','CellOne','CellTwo'}
source_hash=hashlib.sha256((root/'public/fixtures/bookmark-insertion.docx').read_bytes()).hexdigest()
def measure(path):
    tree=E.parse(str(path)); part=tree.find('.//{'+P+'}part[@{'+P+'}name="/word/document.xml"]/{'+P+'}xmlData')
    text=[]; starts={}; ends={}; position=0
    def walk(node):
        nonlocal position
        if node.tag==q('bookmarkStart'): starts[node.get(q('id'))]=(node.get(q('name')),position)
        if node.tag==q('bookmarkEnd'): ends[node.get(q('id'))]=position
        if node.tag==q('t'):
            value=node.text or '';text.append(value);position+=len(value.encode('utf-16-le'))//2
        for child in node: walk(child)
        if node.tag==q('p'): text.append('\n');position+=1
    walk(part); text=''.join(text)
    ranges={name:dict(start=start,end=ends[id],text=text.encode('utf-16-le')[start*2:ends[id]*2].decode('utf-16-le')) for id,(name,start) in starts.items() if name in names}
    assert set(ranges)==names
    return dict(xmlSha256=hashlib.sha256(path.read_bytes()).hexdigest(),text=text,bookmarks=ranges)
result=dict(sourceSha256=source_hash,version='16.0',build='16.0.20326',basis='Literal marker order in reference FlatOPC, projected to paragraph text plus newlines. Reference COM bookmark Range can expand a partial-cell selection to entire rows; those API selections are preserved separately and are not used as XML marker positions.',cases={})
for mode in ['original','append-row','middle-row','prepend-row','append-column','middle-column','prepend-column']:
    if mode!='original':
        meta=json.loads((work/f'bookmark-insertion-{mode}-native.json').read_text(encoding='utf-8'))
        assert meta['sourceSha256'].lower()==source_hash and meta['build']==result['build']
    result['cases'][mode]=measure(work/f'bookmark-insertion-{mode}-native.xml')
args.output.write_text(json.dumps(result,indent=2),encoding='utf-8')
for mode,case in result['cases'].items(): print(mode,{name:value['text'] for name,value in case['bookmarks'].items()})
