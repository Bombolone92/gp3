"""Rejected native subdivision candidate; diagnostic only, never imported by the app.

Exit 1 means native vertices differ. Matching vertex counts is insufficient.
The two-stage input quantization repairs the older fractional ellipse case,
but independent cubic curves reject this as a general renderer implementation.
"""
from pathlib import Path
from hashlib import sha256
import json, math

root = Path(__file__).resolve().parents[1] / 'docs/evidence'

def candidate(coordinates, flatness):
    scale = 4 / flatness
    points = [tuple(math.ceil(math.floor(v*scale*16+.5)/16) for v in p)
              for p in zip(coordinates[::2], coordinates[1::2])]
    result = [points[0]]

    def half(a, b):
        return tuple((x+y)/2 for x, y in zip(a, b))

    def split(p, depth=0):
        deviation = max(abs(p[i][k]-2*p[i+1][k]+p[i+2][k])
                        for i in range(2) for k in range(2))
        if deviation <= 4:
            result.append(p[3])
            return
        assert depth < 16, 'Diagnostic subdivision limit exceeded'
        a,b,c = half(p[0],p[1]),half(p[1],p[2]),half(p[2],p[3])
        d,e = half(a,b),half(b,c)
        f = half(d,e)
        split([p[0],a,d,f],depth+1)
        split([f,e,c,p[3]],depth+1)

    for i in range(0,len(points)-1,3):
        split(points[i:i+4])
    return [tuple(math.floor(v+.5)/scale for v in p) for p in result]

report = []
for name in ['gdi-curve-flattening-2026-09-27.json', 'gdi-bezier-flattening-2026-09-27.json']:
    data = (root/name).read_bytes()
    rows = []
    for index,row in enumerate(json.loads(data.decode('utf-8-sig'))):
        predicted = candidate(row['original'],row['flatness'])
        raw = row['points']
        native = list(zip(raw[::2],raw[1::2]))
        # Native .1-flatness coordinates are float32; tolerate serialization
        # noise, but not a quantized step (.025 at this flatness).
        errors = [dict(vertex=i,predicted=a,native=b)
                  for i,(a,b) in enumerate(zip(predicted,native))
                  if any(abs(x-y)>1e-5 for x,y in zip(a,b))]
        rows.append(dict(case=index,flatness=row['flatness'],
                         predictedCount=len(predicted),nativeCount=len(native),
                         differentVertices=len(errors),examples=errors[:8]))
    report.append(dict(source=name,sourceSha256=sha256(data).hexdigest(),
                       cases=len(rows),countMismatches=sum(r['predictedCount']!=r['nativeCount'] for r in rows),
                       differentVertices=sum(r['differentVertices'] for r in rows),rows=rows))
print(json.dumps(dict(productionActivated=False,references=report),indent=2))
raise SystemExit(int(any(r['countMismatches'] or r['differentVertices'] for r in report)))
