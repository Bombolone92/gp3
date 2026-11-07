"""Reject fixed HSL input quantization followed by exact shading/final rounding.

For the dark half of HSL, every output channel before rounding is k * modifier
for some constant k. Allowing arbitrary k is more permissive than any fixed
HSL quantization. A native byte q with final floor(x+bias) requires
(q-bias)/modifier <= k < (q+1-bias)/modifier. Empty interval intersections
reject this model; they do not establish a replacement rendering algorithm.
"""
from fractions import Fraction
from pathlib import Path
import hashlib
import json

ROOT = Path(__file__).resolve().parents[1]

def analyze(directory):
    cases = json.loads((directory / 'cases.json').read_text())
    reference = json.loads((directory / 'reference.json').read_text())
    for name, key in [('control.docx','sourceSha256'), ('cases.json','casesSha256'), ('native.pdf','pdfSha256')]:
        if hashlib.sha256((directory/name).read_bytes()).hexdigest() != reference[key]:
            raise ValueError('Reference hash mismatch: '+name)
    if [c['label'] for c in cases] != [r['label'] for r in reference['colors']]:
        raise ValueError('Reference labels mismatch')
    result = []
    for base in dict.fromkeys(c['base'] for c in cases):
        zero = [r['rgb'] for c,r in zip(cases,reference['colors'],strict=True)
                if c['base']==base and c['mode']=='shade' and c['value']==0]
        # A final floor(k*modifier+bias) matching black at zero forces 0<=bias<1.
        if zero != [[0,0,0]]: raise ValueError('Zero endpoint does not constrain the output bias')
        samples = [(c,r) for c,r in zip(cases,reference['colors'],strict=True)
                   if c['base']==base and c['mode']=='shade' and 0<c['value']<=128]
        if len(samples)!=128: raise ValueError('Expected complete dark-half modifier range')
        # Even with arbitrary initial HSL, the observed extrema at modifier 128
        # force transformed lightness below 1/2: their sum is far below 253,
        # the minimum possible sum above that boundary after floor/nearest.
        rgb = samples[-1][1]['rgb']
        if min(rgb)+max(rgb)>=253: raise ValueError('Dark-half precondition not proven')
        for name,bias in [('floor',Fraction(0)),('nearest',Fraction(1,2))]:
            channels=[]
            for channel in range(3):
                rows=[((Fraction(r['rgb'][channel])-bias)/c['value'],
                       (Fraction(r['rgb'][channel])+1-bias)/c['value'],c,r)
                      for c,r in samples]
                lower=max(rows,key=lambda row:row[0]); upper=min(rows,key=lambda row:row[1])
                def witness(row,index):
                    return {'label':row[2]['label'],'modifier':row[2]['value'],
                            'rgb':row[3]['rgb'],'slopeBound':str(row[index])}
                channels.append({'channel':'RGB'[channel], 'impossible':lower[0]>=upper[1],
                                 'lowerInclusive':witness(lower,0),'upperExclusive':witness(upper,1)})
            result.append({'base':base,'rounding':name,'modelRejected':any(c['impossible'] for c in channels),'channels':channels})
        # Eliminate an arbitrary fixed additive bias too. Between modifiers a<b,
        # floor(k*b+bias)-floor(k*a+bias)=d requires (d-1)/(b-a)<k<(d+1)/(b-a).
        # Empty intersections reject even a separately chosen bias per channel.
        affine=[]
        for channel in range(3):
            pairs=[]
            for i,(a,ra) in enumerate(samples):
                for b,rb in samples[i+1:]:
                    delta=b['value']-a['value']; difference=rb['rgb'][channel]-ra['rgb'][channel]
                    pairs.append((Fraction(difference-1,delta),Fraction(difference+1,delta),a,ra,b,rb))
            lower=max(pairs,key=lambda row:row[0]);upper=min(pairs,key=lambda row:row[1])
            def pair_witness(row,index):
                return {'from':{'modifier':row[2]['value'],'rgb':row[3]['rgb']},
                        'to':{'modifier':row[4]['value'],'rgb':row[5]['rgb']},'slopeBound':str(row[index])}
            affine.append({'channel':'RGB'[channel],'impossible':lower[0]>=upper[1],
                           'lowerExclusive':pair_witness(lower,0),'upperExclusive':pair_witness(upper,1)})
        result.append({'base':base,'rounding':'floor with any fixed bias','modelRejected':any(c['impossible'] for c in affine),'channels':affine})
    return result

if __name__=='__main__':
    result=analyze(ROOT/'tests/fixtures/theme-low-chroma-sweep')
    if {(r['base'],r['rounding']) for r in result if r['modelRejected'] and r['rounding'] in ['floor','nearest']} != {
        ('7F8080','floor'), ('80817F','floor'), ('80817F','nearest')}:
        raise SystemExit('Native evidence no longer establishes the recorded rejections')
    if not any(r['base']=='80817F' and r['rounding']=='floor with any fixed bias' and r['modelRejected'] for r in result):
        raise SystemExit('Fixed-bias rejection no longer established')
    print(json.dumps(result,indent=2))
