"""Author textless section, paper and row controls without the renderer."""
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED
from xml.etree import ElementTree as ET
from copy import deepcopy
import argparse, hashlib, json

ROOT = Path(__file__).resolve().parents[1]
W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'
ET.register_namespace('w', W)
parser = argparse.ArgumentParser()
parser.add_argument('kind', choices=['row-width', 'paper', 'high-row', 'paper-height', 'tie', 'story-margin', 'coordinate', 'coordinate-independent'])
parser.add_argument('--output-folder',type=Path,help='Fresh or empty directory for a new control; existing captures are never overwritten')
args = parser.parse_args()
folder = args.output_folder if args.output_folder is not None else ROOT / 'tests/fixtures' / ('print-'+args.kind+'-phase')
if folder.exists() and (not folder.is_dir() or any(folder.iterdir())):
    parser.error('Output must be a fresh or empty directory. Use --output-folder to preserve existing sources and native captures.')
folder.mkdir(parents=True, exist_ok=True)
cases = []

def case(size, row, width=612, height=792, top=720, grid=4320):
    cases.append(dict(index=len(cases), page=len(cases), pageWidthPt=width,
        pageHeightPt=height, topTwips=top, leftTwips=720, widthTwips=grid,
        heightTwips=row, sizeEighthPoints=size))

if args.kind == 'row-width':
    for size in [3,5,15]:
        for row in range(396,408): case(size,row)
elif args.kind == 'paper':
    for width,height,threshold,grid in [(612,792,1575,8640),(792,612,1215,8640),
                                      (306,396,783,2880),(720,720,1431,8640)]:
        for top in [1440,threshold]: case(8,400,width,height,top,grid)
elif args.kind == 'high-row':
    for size in [9,15]:
        for top in [4455,7755]:
            for row in [400,403]: case(size,row,top=top)
elif args.kind == 'paper-height':
    # Keep the table and its absolute origin fixed while only paper height
    # changes. This separates vertical page conversion from row allocation.
    for height in [396,480,612,720,792,1008]:
        for size in [8,9,15]:
            for row in [400,403]: case(size,row,height=height,top=4455)
elif args.kind == 'tie':
    # Integral even/odd 600dpi half-grid ties, at two absolute origins and
    # two table widths. The cases discriminate tie handling independently
    # from any PDF page-coordinate projection.
    for top in [4455,7755]:
        for row in [403,415]:
            for grid in [4320,8640]: case(8,row,top=top,grid=grid)
elif args.kind in ['coordinate', 'coordinate-independent']:
    # Hold out absolute origins and row/pen combinations from earlier controls.
    # These positions distinguish conversion and summation order without a
    # source-dependent epsilon, device-phase adjustment or renderer input.
    origins = [719, 721, 4456, 7754] if args.kind == 'coordinate' else [723, 1441, 4457, 7753]
    heights = [398, 402, 406, 407] if args.kind == 'coordinate' else [397, 401, 405, 409]
    for top in origins:
        for row in heights:
            for size in [3, 5, 8, 12, 16]: case(size, row, top=top)
else:
    # The original low-origin holdout retains half-inch story margins while
    # later controls use zero. Change only those margins at each origin/row.
    for top in [720,4455]:
        for row in [403,406]:
            for margin in [0,720]:
                case(8,row,top=top)
                cases[-1]['storyMarginTwips']=margin

def node(parent,name,**attrs):
    return ET.SubElement(parent,'{'+W+'}'+name,{'{'+W+'}'+k:str(v) for k,v in attrs.items()})

with ZipFile(ROOT/'tests/fixtures/print-row-phase/control.docx') as shell:
    doc=ET.fromstring(shell.read('word/document.xml'));doc.attrib.clear()
    body=doc.find('{'+W+'}body')
    template=deepcopy(body.find('{'+W+'}tbl'));section=deepcopy(body.find('{'+W+'}sectPr'))
    body.clear()
    for item in cases:
        table=deepcopy(template);body.append(table)
        for tag in ['tblW','gridCol','tcW']:
            table.find('.//{'+W+'}'+tag).set('{'+W+'}w',str(item['widthTwips']))
        table.find('.//{'+W+'}trHeight').set('{'+W+'}val',str(item['heightTwips']))
        for border in table.findall('.//{'+W+'}tblBorders/*'):
            border.set('{'+W+'}sz',str(item['sizeEighthPoints']))
        ppr=node(node(body,'p'),'pPr')
        node(ppr,'spacing',before=0,after=0,line=20,lineRule='exact')
        node(node(ppr,'rPr'),'sz',val=2)
        boundary=deepcopy(section);size=boundary.find('{'+W+'}pgSz')
        size.set('{'+W+'}w',str(item['pageWidthPt']*20))
        size.set('{'+W+'}h',str(item['pageHeightPt']*20));size.attrib.pop('{'+W+'}orient',None)
        margins=boundary.find('{'+W+'}pgMar')
        storyMargin=item.get('storyMarginTwips',720 if args.kind=='row-width' else 0)
        for key,value in dict(top=item['topTwips'],left=720,right=720,bottom=720,header=storyMargin,footer=storyMargin,gutter=0).items():
            margins.set('{'+W+'}'+key,str(value))
        if item['index'] < len(cases)-1:
            boundary.insert(0,ET.Element('{'+W+'}type',{'{'+W+'}val':'nextPage'}));ppr.append(boundary)
        else: body.append(boundary)
    xml=ET.tostring(doc,encoding='utf-8',xml_declaration=True)
    with ZipFile(folder/'control.docx','x',ZIP_DEFLATED) as target:
        for name in shell.namelist():
            target.writestr(name,xml if name=='word/document.xml' else shell.read(name))
with (folder/'cases.json').open('xb') as target:
    target.write((json.dumps(cases,indent=2)+'\n').encode())
print(json.dumps(dict(cases=len(cases),sourceSha256=hashlib.sha256((folder/'control.docx').read_bytes()).hexdigest())))
