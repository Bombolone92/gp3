"""Read the bounded original phase fixture's GDI baseline records, not arbitrary EMF."""
from pathlib import Path
import hashlib,json,struct
from zipfile import ZipFile
from xml.etree import ElementTree as E
from inspect_emf_text_records import inspect

ROOT=Path(__file__).resolve().parents[1]
FOLDER=ROOT/'tests/fixtures/cell-text-direction/origin-phase'

def baseline_records(data, *, face='Arial', advance=46, height=-83, directions=('btLr',)*6+('tbRl',)*6):
    # The generic inspector validates record sizes and Unicode text before this
    # fixture-specific mapping check. Refuse transforms or alignment changes.
    rows=inspect(data);offset=0;extent=None;align=None
    while offset<len(data):
        kind,size=struct.unpack_from('<II',data,offset)
        if kind in (11,17,31,32,35,36,115):raise ValueError('Unexpected mapping/layout transform')
        if kind in (10,12) and struct.unpack_from('<2i',data,offset+8)!=(0,0):raise ValueError('Nonzero origin')
        if kind==9:
            current=struct.unpack_from('<2i',data,offset+8)
            if extent and current!=extent:raise ValueError('Varying extent')
            extent=current
        if kind==22:
            align=struct.unpack_from('<I',data,offset+8)[0]
            if align!=24:raise ValueError('Expected left/baseline text alignment')
        if kind==84 and align!=24:raise ValueError('Missing baseline alignment')
        offset+=size
    frame=struct.unpack_from('<4i',data,24)
    if not extent or frame[:2]!=(0,0) or extent[0]<=0:raise ValueError('Unexpected frame')
    scale=frame[2]/2540*72/extent[0]
    labels=[r for r in rows if r['text']=='a']
    if len(labels)!=len(directions) or any(d not in ('btLr','tbRl') for d in directions):raise ValueError('Unexpected original labels/directions')
    for i,row in enumerate(labels):
        font=row['font'];angle=900 if directions[i]=='btLr' else 2700
        if font!={'height':height,'width':0,'escapement':angle,'orientation':angle,'weight':400,'face':face}:raise ValueError('Unexpected reference font')
        if row['advances']!=[advance] or row['advanceDimensions']!=1:raise ValueError('Changed glyph advance')
    return scale,[{'direction':directions[i],'logicalX':r['logicalOrigin'][0]}for i,r in enumerate(labels)]

def record(folder=FOLDER):
    w='{http://schemas.openxmlformats.org/wordprocessingml/2006/main}'
    with ZipFile(folder/'control.docx')as z:xml=E.fromstring(z.read('word/document.xml'))
    left=int(xml.find('.//'+w+'pgMar').get(w+'left'))/20
    pdf=json.loads((folder/'reference.json').read_text());cases=[]
    names=['control.docx','native.pdf','reference.json','cases.json']
    for i,case in enumerate(pdf['cases'],1):
        page=f'native-page-{i}.emf';table=f'native-table-{i}.emf';names.extend([page,table])
        scale,rows=baseline_records((folder/page).read_bytes())
        other_scale,other=baseline_records((folder/table).read_bytes())
        if rows!=other or scale!=other_scale:raise ValueError('Extraction changed horizontal origins')
        # Compare increments, so this conclusion does not depend on a fitted
        # absolute page translation or font-specific baseline offset.
        native=case['runs'];deltas=[]
        for direction in ['btLr','tbRl']:
            xs=[r['logicalX']*scale for r in rows if r['direction']==direction]
            px=[r['x']for r in native if r['direction']==direction]
            deltas.extend(abs((b-a)-(d-c))for a,b,c,d in zip(xs,xs[1:],px,px[1:]))
        cases.append({'twips':case['twips'],'logicalUnitPt':scale,'rows':rows,'maximumPdfIncrementDifferencePt':max(deltas)})
    return {'referenceBuild':'16.0.20326','pageLeftPt':left,'hashes':{n:hashlib.sha256((folder/n).read_bytes()).hexdigest()for n in names},'cases':cases}

if __name__=='__main__':
    result=record();(FOLDER/'native-reference.json').write_text(json.dumps(result,indent=2)+'\n');print('Recorded 96 native origins in paired page/table captures')
