"""Original OOXML controls for flat shapes on otherwise image-only lines."""
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED
import json
from lxml import etree as E
from canvas_group_fixture import NS, tag, add

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT/'tests/fixtures/flat-line-baseline'
CASES = [
    dict(name='arial-zero', font='Arial', size=12),
    dict(name='gothic-zero', font='Century Gothic', size=10),
    dict(name='large-zero', font='Arial', size=24),
    dict(name='large-run-small-mark', font='Arial', size=24, mark=12),
    dict(name='one-point-height', font='Arial', size=12, height=1),
    dict(name='twelve-point-height', font='Arial', size=12, height=12),
    dict(name='table-zero', font='Arial', size=12, table=True),
    dict(name='raised-zero', font='Arial', size=12, shift=3),
    dict(name='effect-extents-zero', font='Arial', size=12, top=2, bottom=3),
    dict(name='mixed-text-zero', font='Arial', size=12, text=True),
    dict(name='vertical-line', font='Arial', size=12, width=0, height=12),
    dict(name='at-least-zero', font='Arial', size=12, rule='atLeast'),
    dict(name='exact-zero', font='Arial', size=12, rule='exact'),
]

def formatting(parent, font, size):
    add(parent,'w:rFonts',**{'w:ascii':font,'w:hAnsi':font})
    add(parent,'w:sz',**{'w:val':size*2})

def text_paragraph(parent,text,page_break=False):
    p=add(parent,'w:p');pr=add(p,'w:pPr')
    if page_break:add(pr,'w:pageBreakBefore')
    add(pr,'w:spacing',**{'w:after':0,'w:line':240,'w:lineRule':'auto'})
    formatting(add(pr,'w:rPr'),'Arial',10)
    r=add(p,'w:r');formatting(add(r,'w:rPr'),'Arial',10);add(r,'w:t',text=text)

def generate(mode):
    with ZipFile(ROOT/'public/fixtures/numeric-page-fields.docx') as z:
        parts={n:z.read(n) for n in ['[Content_Types].xml','_rels/.rels','word/styles.xml','word/_rels/document.xml.rels']}
    root=E.Element(tag('w:document'),nsmap=NS);body=add(root,'w:body')
    for index,c in enumerate(CASES):
        text_paragraph(body,c['name'],index>0)
        host=body
        if c.get('table'):
            table=add(body,'w:tbl');pr=add(table,'w:tblPr');add(pr,'w:tblW',**{'w:type':'dxa','w:w':6000});add(pr,'w:tblLayout',**{'w:type':'fixed'})
            margins=add(pr,'w:tblCellMar')
            for side in ['top','left','bottom','right']:add(margins,'w:'+side,**{'w:type':'dxa','w:w':0})
            add(add(table,'w:tblGrid'),'w:gridCol',**{'w:w':6000})
            host=add(add(table,'w:tr'),'w:tc');add(add(host,'w:tcPr'),'w:tcW',**{'w:type':'dxa','w:w':6000})
        p=add(host,'w:p');pr=add(p,'w:pPr');rule=c.get('rule','auto')
        add(pr,'w:spacing',**{'w:after':0,'w:line':240 if rule=='auto' else 480,'w:lineRule':rule})
        formatting(add(pr,'w:rPr'),c['font'],c.get('mark',c['size']))
        if c.get('text'):
            r=add(p,'w:r');formatting(add(r,'w:rPr'),c['font'],c['size']);add(r,'w:t',text='X')
        r=add(p,'w:r');rp=add(r,'w:rPr');formatting(rp,c['font'],c['size'])
        if c.get('shift'):add(rp,'w:position',**{'w:val':c['shift']*2})
        frame=add(add(r,'w:drawing'),'wp:inline',distT=0,distB=0,distL=0,distR=0)
        width,height=c.get('width',108)*12700,c.get('height',0)*12700
        add(frame,'wp:extent',cx=width,cy=height)
        add(frame,'wp:effectExtent',l=0,t=c.get('top',0)*12700,r=0,b=c.get('bottom',0)*12700)
        add(frame,'wp:docPr',id=index+1,name=c['name'])
        shape=add(add(add(frame,'a:graphic'),'a:graphicData',uri=NS['wps']),'wps:wsp');add(shape,'wps:cNvCnPr')
        sp=add(shape,'wps:spPr');xf=add(sp,'a:xfrm');add(xf,'a:off',x=0,y=0);add(xf,'a:ext',cx=width,cy=height)
        add(add(sp,'a:prstGeom',prst='line'),'a:avLst');add(sp,'a:noFill')
        add(add(add(sp,'a:ln',w=12700,cap='flat'),'a:solidFill'),'a:srgbClr',val='E02030');add(shape,'wps:bodyPr')
        text_paragraph(body,'After '+c['name'])
    sect=add(body,'w:sectPr');add(sect,'w:pgSz',**{'w:w':12240,'w:h':15840});add(sect,'w:pgMar',**{'w:top':1440,'w:right':1440,'w:bottom':1440,'w:left':1440,'w:header':0,'w:footer':0,'w:gutter':0})
    parts['word/document.xml']=E.tostring(root,encoding='UTF-8',xml_declaration=True,standalone=True)
    parts['word/footer.xml']=f'<w:ftr xmlns:w="{NS["w"]}"><w:p/></w:ftr>'.encode()
    parts['word/settings.xml']=f'<w:settings xmlns:w="{NS["w"]}"><w:compat><w:compatSetting w:name="compatibilityMode" w:uri="http://schemas.microsoft.com/office/word" w:val="{mode}"/></w:compat></w:settings>'.encode()
    OUT.mkdir(parents=True,exist_ok=True)
    with ZipFile(OUT/f'mode-{mode}.docx','w',ZIP_DEFLATED) as z:
        for n,b in parts.items():z.writestr(n,b)
    (OUT/'cases.json').write_text(json.dumps(CASES,indent=2)+'\n')

if __name__=='__main__':
    for mode in [12,15]:generate(mode)
