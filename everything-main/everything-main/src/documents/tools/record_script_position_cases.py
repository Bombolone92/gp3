"""Bind native positions to independently read font facts; never copy font binaries."""
from pathlib import Path
import json,hashlib,math
from fontTools.ttLib import TTFont

ROOT=Path(__file__).resolve().parents[1]
TARGET=ROOT/'tests/fixtures/script-position-native'
def digest(path):return hashlib.sha256(path.read_bytes()).hexdigest()
def main():
    TARGET.mkdir(exist_ok=True);rows=[];fonts=[];indices={};hashes={}
    def bind(path,expected=None):
        actual=digest(path);assert expected is None or actual==expected
        if path.suffix=='.json':actual=hashlib.sha256(path.read_bytes().replace(b'\r\n',b'\n')).hexdigest()
        hashes[path.relative_to(ROOT).as_posix()]=actual
    def add(path,size,script,rise,small,label):
        index=indices.get(path)
        if index is None:
            index=len(fonts);indices[path]=index
            with TTFont(path) as font:
                o=font['OS/2'];h=font['hhea'];em=font['head'].unitsPerEm
                values=[getattr(o,name) for name in ['ySubscriptXSize','ySubscriptYSize','ySubscriptXOffset','ySubscriptYOffset','ySuperscriptXSize','ySuperscriptYSize','ySuperscriptXOffset','ySuperscriptYOffset']]
                bounds={}
                if 'VDMX' in font:
                    table=font['VDMX']
                    for ratio in table.ratRanges:
                        if (ratio['bCharSet']==1 or table.version==1 and ratio['bCharSet']==0) and (ratio['xRatio']==0 or ratio['yStartRatio']<=ratio['xRatio']<=ratio['yEndRatio']):
                            bounds={p:[a,-d] for p,(a,d) in table.groups[ratio['groupIndex']].items()};break
                metadata=dict(unitsPerEm=em,scriptMetrics=values,scriptPositionMetrics=dict(ascent=o.usWinAscent,descent=o.usWinDescent,
                              externalLeading=max(0,h.ascent-h.descent+h.lineGap-o.usWinAscent-o.usWinDescent),deviceBounds={}))
                if 'fvar' in font:
                    tags={r.ValueTag for r in font['MVAR'].table.ValueRecord} if 'MVAR' in font else set()
                    metadata.update(variable=True,scriptSizeInvariant=not tags.intersection({'sbys','sbyo','spys','spyo'}),
                                    scriptPositionInvariant=not tags.intersection({'sbys','sbyo','spys','spyo','hasc','hdsc','hlgp','hcla','hcld'}))
            system=not path.is_relative_to(ROOT)
            fonts.append(dict(file=path.name if system else path.relative_to(ROOT).as_posix(),system=system,sha256=digest(path),metadata=metadata))
            indices[(path,'bounds')]=bounds
            if not system:bind(path)
        # Retain only the device-bound numeric observations used by these rows,
        # rather than distributing an installed font's complete VDMX table.
        sample=small if script=='subscript' else min(small,math.floor(size*4/3+.5)/2)
        for p in [math.floor(size/.12+.5),math.floor(sample/.12+.5)]:
            bounds=indices[(path,'bounds')]
            if p in bounds:fonts[index]['metadata']['scriptPositionMetrics']['deviceBounds'][str(p)]=bounds[p]
        rows.append(dict(font=index,size=size,script=script,nativeRise=rise,nativeSize=small,label=label))
    folder=ROOT/'tests/fixtures/script-size';ref=json.loads((folder/'reference.json').read_text());bind(folder/'reference.json')
    bind(folder/'control.docx',ref['sourceSha256']);bind(folder/'native.pdf',ref['pdfSha256'])
    for c in ref['cases']:
        fact=ref['fonts'][c['family']][['regular','bold','italic'].index(c['face'])]
        path=Path('C:/Windows/Fonts')/fact['file'];assert digest(path)==fact['sha256']
        for r in c['rows']:add(path,r['size'],r['script'],r['rise'],r['nativeSize'],c['family']+'/'+c['face'])
    for name,filename in [('script-position-metrics','emf-reference.json'),('script-vdmx-position','reference.json'),('script-vdmx-ppem','reference.json'),('script-device-caps','reference.json'),('script-size-offset','reference.json'),('script-sub-offset','reference.json'),('script-sub-offset-threshold','reference.json')]:
        folder=ROOT/'tests/fixtures'/name;ref=json.loads((folder/filename).read_text());bind(folder/filename)
        for file,d in ref['hashes'].items():bind(folder/file,d)
        for c in ref['cases']:
            for r in c['rows']:add(folder/(c['family'].replace(' ','')+'.ttf'),r['size'],r['script'],r['risePt'],-r['scriptHeight']*.12,c['family'])
    folder=ROOT/'tests/fixtures/script-metric-controls';ref=json.loads((folder/'reference.json').read_text());bind(folder/'reference.json')
    bind(folder/'controls.docx',ref['sourceSha256']);bind(folder/'controls-native.pdf',ref['pdfSha256'])
    for c in ref['pages']:
        path=folder/c['font'];bind(path,c['fontSha256'])
        for script in ['superscript','subscript']:add(path,20,script,c[script]['rise'],c[script]['size'],c['font'])
    folder=ROOT/'tests/fixtures/bundled-script';ref=json.loads((folder/'position-reference.json').read_text());bind(folder/'position-reference.json')
    bind(folder/'control.docx',ref['sourceSha256']);bind(folder/'cases.json',ref['casesSha256'])
    for c in ref['cases']:
        bind(folder/c['metafile'],c['metafileSha256']);bind(ROOT/'public/fonts'/c['font'],c['fontSha256'])
        for r in c['rows']:add(ROOT/'public/fonts'/c['font'],r['size'],r['script'],r['risePt'],-r['scriptHeight']*.12,c['family']+'/'+c['face'])
    out=dict(scope='Native ordinary-script sizes and vertical origins; independently read font facts.',
             hashNormalization='JSON CRLF to LF only; binary inputs remain exact.',hashes=hashes,fonts=fonts,cases=rows)
    (TARGET/'cases.json').write_text(json.dumps(out,indent=2)+'\n',newline='\n')
    assert len(rows)==558
    print('Bound 558 native script observations and',len(fonts),'font metric sets')
if __name__=='__main__':main()
