"""Derive minimal margin controls from the independently authored column control."""
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED
from lxml import etree as E
ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'tests/fixtures/table-margin-defaults'
W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'
R = 'http://schemas.openxmlformats.org/package/2006/relationships'
C = 'http://schemas.openxmlformats.org/package/2006/content-types'
def generate():
    OUT.mkdir(parents=True, exist_ok=True)
    for name in ['one-column', 'empty-styles', 'default-table-style', 'explicit-margins', 'borderless', 'custom-empty', 'custom-empty-14', 'one-column-14', 'default-table-style-14', 'named-default-14']:
        with ZipFile(ROOT / 'tests/fixtures/column-flow/wide-table.docx') as z:
            parts = {n:z.read(n) for n in z.namelist()}
        doc = E.fromstring(parts['word/document.xml']); pr = doc.find('.//{%s}tblPr' % W)
        if name.startswith('one-column') or name == 'borderless':
            doc.find('.//{%s}cols' % W).set('{%s}num' % W, '1')
        if name == 'borderless': pr.remove(pr.find('{%s}tblBorders' % W))
        if not name.startswith('one-column') and name != 'borderless':
            styles = E.Element('{%s}styles' % W, nsmap={'w':W})
            if name != 'empty-styles':
                custom = name.startswith('custom-empty')
                s = E.SubElement(styles, '{%s}style' % W)
                for k,v in {'type':'table','styleId':'Probe' if custom else 'TableNormal', 'customStyle' if custom else 'default':'1'}.items(): s.set('{%s}%s' % (W,k),v)
                if name == 'named-default-14':
                    n=E.SubElement(s,'{%s}name' % W); n.set('{%s}val' % W,'Normal Table')
                if custom:
                    ts=E.Element('{%s}tblStyle' % W); ts.set('{%s}val' % W,'Probe'); pr.insert(0,ts)
                if name == 'explicit-margins':
                    mar=E.SubElement(E.SubElement(s,'{%s}tblPr' % W),'{%s}tblCellMar' % W)
                    for side in ['left','right']:
                        n=E.SubElement(mar,'{%s}%s' % (W,side)); n.set('{%s}w' % W,'115'); n.set('{%s}type' % W,'dxa')
            parts['word/styles.xml']=E.tostring(styles)
            rels=E.fromstring(parts['word/_rels/document.xml.rels']); E.SubElement(rels,'{%s}Relationship' % R,Id='rIdStyles',Type='http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles',Target='styles.xml'); parts['word/_rels/document.xml.rels']=E.tostring(rels)
            ct=E.fromstring(parts['[Content_Types].xml']); E.SubElement(ct,'{%s}Override' % C,PartName='/word/styles.xml',ContentType='application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml'); parts['[Content_Types].xml']=E.tostring(ct)
        if name.endswith('-14'):
            s=E.fromstring(parts['word/settings.xml']); s.find('.//{%s}compatSetting' % W).set('{%s}val' % W,'14'); parts['word/settings.xml']=E.tostring(s)
        parts['word/document.xml']=E.tostring(doc)
        with ZipFile(OUT/(name+'.docx'),'w',ZIP_DEFLATED) as z:
            for n,b in parts.items():z.writestr(n,b)
if __name__ == '__main__': generate()
