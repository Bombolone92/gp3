"""Independent GDI+ arithmetic diagnostic, not a renderer implementation.

Unlike reference SVG, a direct transparent GDI+ brush can still quantize its
destination. Do not apply that API behavior to elided SVG transparent paints.
"""
from pathlib import Path
import json, math
root=Path(__file__).resolve().parents[1]
rows=json.loads((root/'docs/evidence/gdi-argb-composition-2026-09-27.json').read_text())
def nearest(v):return math.floor(v+.5)
def over(destination,source):
    da,sa=destination[3],source[3]
    alpha=sa+nearest(da*(255-sa)/255)
    if not alpha:return [0,0,0,0]
    inverse=math.floor(255*65536/alpha)
    rgb=[math.floor((nearest(source[i]*sa/255)+nearest(nearest(destination[i]*da/255)*(255-sa)/255))*inverse/65536) for i in range(3)]
    return rgb+[alpha]
failures=[dict(row,predicted=over(over([0,0,0,0],row['first']),row['second'])) for row in rows if over(over([0,0,0,0],row['first']),row['second'])!=row['native']]
print(json.dumps(dict(total=len(rows),failures=len(failures),examples=failures[:8]),indent=2))
raise SystemExit(int(bool(failures)))
