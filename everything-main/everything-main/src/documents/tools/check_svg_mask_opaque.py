"""Verify the observed reference opaque-mask switch against paired native rasters.

These expected paths describe original controls, not an SVG classification
implementation. The renderer still needs a general classifier and rasterizer.
"""
from pathlib import Path
import json,subprocess,sys
root=Path(__file__).resolve().parents[1]
expected={
 'svg-mask-opacity':[True,False,False,False,False,False],
 'svg-mask-opacity-expanded':[True,True,False,False,False,True],
 'svg-mask-opaque':[True,False,True,False,True,True],
}
rows=[]
for fixture,opaque in expected.items():
 results=[]
 for flags in [[],['--opaque-luminance']]:
  run=subprocess.run([sys.executable,str(root/'tools/check_svg_mask_composition.py'),fixture,*flags],capture_output=True,text=True)
  assert run.returncode in [0,1],run.stderr
  results.append(json.loads(run.stdout))
 for i,omit_alpha in enumerate(opaque):
  weighted,unweighted=[result[i] for result in results]
  selected=(unweighted if omit_alpha else weighted)
  rows.append(dict(fixture=fixture,case=i,opaque=omit_alpha,
    weightedDifferences=weighted['differentPixels'],unweightedDifferences=unweighted['differentPixels'],
    selectedDifferences=selected['differentPixels']))
print(json.dumps(rows,indent=2))
raise SystemExit(int(any(row['selectedDifferences'] for row in rows)))
