"""Original local SVG reuse controls, including clipping and instance styles.

Reuses the independently authored picture/group/fill packaging generator.
No corpus artwork is included. Run from the repository root.
"""
from pathlib import Path
import sys
import canvas_svg_fixture as fixture

fixture.SOURCE = Path(__file__).resolve().parents[1] / 'public/fixtures/svg-use-pictures.docx'
fixture.SVG = b'''<svg xmlns="http://www.w3.org/2000/svg"
 xmlns:xlink="http://www.w3.org/1999/xlink" width="120" height="80" viewBox="0 0 120 80">
 <defs>
  <rect id="tile" width="16" height="16"/>
  <rect id="blue" width="16" height="16" fill="#2050e0"/>
  <g id="nested"><use xlink:href="#tile" x="2" y="2"/></g>
  <path id="line" d="M0 0H20"/>
  <rect id="clipRect" x="5" y="45" width="16" height="16"/>
  <clipPath id="clip"><use xlink:href="#clipRect" width="100%" height="100%" overflow="visible"/></clipPath>
 </defs>
 <rect width="120" height="80" fill="#eeeeee"/>
 <use xlink:href="#tile" x="5" y="5" fill="#18a060"/>
 <use xlink:href="#blue" x="35" y="5" fill="#e02030"/>
 <use xlink:href="#nested" x="63" y="3" fill="#e02030"/>
 <g transform="translate(95 5) scale(.5)"><use xlink:href="#tile" width="32" height="32" fill="#8040c0"/></g>
 <rect x="0" y="40" width="30" height="30" fill="#18a060" clip-path="url(#clip)"/>
 <use xlink:href="#line" x="35" y="53" fill="none" stroke="#e02030" stroke-width=".2"/>
 <g transform="translate(65 53) scale(.5)"><use xlink:href="#line" fill="none" stroke="#2050e0" stroke-width=".2"/></g>
 <use xlink:href="#tile" x="95" y="45" fill="#e02030" fill-opacity=".3"/>
</svg>'''

if __name__ == '__main__':
    if '--styles' in sys.argv:
        fixture.SOURCE = fixture.SOURCE.with_name('svg-use-styles.docx')
        fixture.SVG = b'''<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="120" height="80" viewBox="0 0 120 80">
<style>.source rect {fill:#2050e0} .instance {fill:#18a060} g > .local {fill:#e02030} .instance > rect {fill:#8040c0} .paint {fill:#18a060} #fixed {fill:#2050e0}</style>
<defs>
 <g class="source"><rect id="parentStyle" width="16" height="16"/></g>
 <g id="group"><rect class="local" width="16" height="16"/></g>
 <rect id="fixed" class="paint" width="16" height="16"/>
 <rect id="clipShape" width="16" height="16"/>
 <clipPath id="clip"><use xlink:href="#clipShape" x="5" y="45"/></clipPath>
</defs>
<rect width="120" height="80" fill="#eeeeee"/>
<use class="instance" xlink:href="#parentStyle" x="5" y="5"/>
<use class="instance" xlink:href="#group" x="35" y="5"/>
<use xlink:href="#fixed" x="65" y="5" fill="#e02030"/>
<use href="#fixed" x="95" y="5"/>
<rect width="30" height="80" fill="#18a060" clip-path="url(#clip)"/>
<use xlink:href="#clipShape" x="35" y="45" style="fill:#e02030"/>
<use xlink:href="#clipShape" x="54.1666667%" y="56.25%" fill="#18a060"/>
<use href="#fixed" xlink:href="#group" x="95" y="45"/>
</svg>'''
    fixture.generate()
    print(fixture.SOURCE)
