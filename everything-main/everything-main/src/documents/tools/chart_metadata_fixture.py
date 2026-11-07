"""Original chart metadata/text controls; authored XML and an embedded XLSX."""
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED
from io import BytesIO
from copy import deepcopy
from lxml import etree as E
from canvas_drawings_fixture import NS, A, C, add

root=Path(__file__).resolve().parents[1]
R=NS['r']; MC='http://schemas.openxmlformats.org/markup-compatibility/2006'
C14='http://schemas.microsoft.com/office/drawing/2007/8/2/chart'
C16='http://schemas.microsoft.com/office/drawing/2014/chart'
C16R3='http://schemas.microsoft.com/office/drawing/2017/03/chart'
P='http://schemas.openxmlformats.org/package/2006/relationships'
CT='http://schemas.openxmlformats.org/package/2006/content-types'
S='http://schemas.openxmlformats.org/spreadsheetml/2006/main'

def xml(n):return E.tostring(n,xml_declaration=True,encoding='UTF-8',standalone=True)
def workbook():
    out=BytesIO()
    types=E.Element('{'+CT+'}Types',nsmap={None:CT})
    for ext,mime in [('rels','application/vnd.openxmlformats-package.relationships+xml'),('xml','application/xml')]: E.SubElement(types,'{'+CT+'}Default',Extension=ext,ContentType=mime)
    for part,mime in [('workbook.xml','sheet.main'),('worksheets/sheet1.xml','worksheet')]:E.SubElement(types,'{'+CT+'}Override',PartName='/xl/'+part,ContentType='application/vnd.openxmlformats-officedocument.spreadsheetml.'+mime+'+xml')
    rel=E.Element('{'+P+'}Relationships',nsmap={None:P});E.SubElement(rel,'{'+P+'}Relationship',Id='book',Type=R+'/officeDocument',Target='xl/workbook.xml')
    book=E.Element('{'+S+'}workbook',nsmap={None:S,'r':R});sheets=E.SubElement(book,'{'+S+'}sheets');E.SubElement(sheets,'{'+S+'}sheet',name='Sheet1',sheetId='1',attrib={'{'+R+'}id':'sheet'})
    links=E.Element('{'+P+'}Relationships',nsmap={None:P});E.SubElement(links,'{'+P+'}Relationship',Id='sheet',Type=R+'/worksheet',Target='worksheets/sheet1.xml')
    sheet=E.Element('{'+S+'}worksheet',nsmap={None:S});data=E.SubElement(sheet,'{'+S+'}sheetData')
    rows=[['','North','South','West'],['Q1',2,3,5],['Q2',4,6,10],['Q3',0,0,0],['Q4',3,2,5]]
    for i,row in enumerate(rows,1):
        e=E.SubElement(data,'{'+S+'}row',r=str(i))
        for j,value in enumerate(row):
            cell=E.SubElement(e,'{'+S+'}c',r=chr(65+j)+str(i))
            if isinstance(value,str):cell.set('t','inlineStr');E.SubElement(E.SubElement(cell,'{'+S+'}is'),'{'+S+'}t').text=value
            else:E.SubElement(cell,'{'+S+'}v').text=str(value)
    with ZipFile(out,'w',ZIP_DEFLATED) as z:
        for path,n in [('[Content_Types].xml',types),('_rels/.rels',rel),('xl/workbook.xml',book),('xl/_rels/workbook.xml.rels',links),('xl/worksheets/sheet1.xml',sheet)]:z.writestr(path,xml(n))
    return out.getvalue()

def text(parent,size=900,font='+mn-lt',bold=0,italic=0,color='000000',rot='0'):
    tx=add(parent,'c:txPr');add(tx,'a:bodyPr',rot=rot,spcFirstLastPara='1',vertOverflow='ellipsis',vert='horz',wrap='square',anchor='ctr',anchorCtr='1');add(tx,'a:lstStyle')
    p=add(tx,'a:p');r=add(add(p,'a:pPr'),'a:defRPr',sz=size,b=bold,i=italic,u='none',strike='noStrike',kern=1200,baseline=0)
    add(add(r,'a:ln'),'a:noFill');add(add(r,'a:solidFill'),'a:srgbClr',val=color);add(r,'a:latin',typeface=font);add(p,'a:endParaRPr',lang='en-US')
    return tx

for name in ['chart-metadata-basic','chart-metadata-auto','chart-text-inherited','chart-text-italic','chart-metadata-order']:
    with ZipFile(root/'public/fixtures/chart-theme-colors.docx') as z:parts={n:z.read(n) for n in z.namelist()}
    chart=E.fromstring(parts['word/charts/chart1.xml']);body=chart.find('c:chart',NS);plot=body.find('c:plotArea',NS);bars=plot.find('c:barChart',NS)
    chart.insert(0,E.Element('{'+C+'}date1904',val='1'))
    chart.insert(2,E.Element('{'+C+'}roundedCorners',val='0'))
    if name in ['chart-metadata-auto','chart-metadata-order']:
        ac=E.Element('{'+MC+'}AlternateContent',nsmap={'mc':MC});choice=E.SubElement(ac,'{'+MC+'}Choice',nsmap={'c14':C14},Requires='c14');E.SubElement(choice,'{'+C14+'}style',val='103');fb=E.SubElement(ac,'{'+MC+'}Fallback');E.SubElement(fb,'{'+C+'}style',val='3');chart.insert(3,ac)
    else:chart.insert(3,E.Element('{'+C+'}style',val='3'))
    body.insert(0,E.Element('{'+C+'}autoTitleDeleted'))
    labels=E.Element('{'+C+'}dLbls')
    for k in ['showLegendKey','showVal','showCatName','showSerName','showPercent','showBubbleSize']:add(labels,'c:'+k,val=0)
    bars.insert(list(bars).index(bars.find('c:gapWidth',NS)),labels)
    add(body,'c:dispBlanksAs',val='span');add(body,'c:showDLblsOverMax',val=0)
    ext=add(add(body,'c:extLst'),'c:ext',uri='{56B9EC1D-385E-4148-901F-78D8002777C0}')
    opt=E.SubElement(ext,'{'+C16R3+'}dataDisplayOptions16',nsmap={'c16r3':C16R3});E.SubElement(opt,'{'+C16R3+'}dispNaAsBlank',val='1')
    if name=='chart-metadata-order':
        flag=body.find('c:showDLblsOverMax',NS);body.remove(flag);body.append(flag)
    for i,ser in enumerate(bars.findall('c:ser',NS)):
        ext=add(add(ser,'c:extLst'),'c:ext',uri='{C3380CC4-5D6E-409C-BE32-E72D297353CC}')
        E.SubElement(ext,'{'+C16+'}uniqueId',nsmap={'c16':C16},val='{00000000-0000-4000-8000-'+str(i+1).zfill(12)+'}')
        ser.find('c:tx/c:strRef/c:f',NS).text=f'Sheet1!${chr(66+i)}$1'
        ser.find('c:cat/c:strRef/c:f',NS).text='Sheet1!$A$2:$A$5'
        ser.find('c:val/c:numRef/c:f',NS).text=f'Sheet1!${chr(66+i)}$2:${chr(66+i)}$5'
    for line in chart.findall('.//c:spPr/a:ln',NS):
        for k,v in dict(w='9525',cap='flat',cmpd='sng',algn='ctr').items():line.set(k,v)
        add(line,'a:round')
    root_text=text(chart,size=1400 if name=='chart-text-inherited' else 900,font='Arial' if name=='chart-text-inherited' else '+mn-lt',bold=int(name=='chart-text-inherited'),color='662211' if name=='chart-text-inherited' else '000000')
    for kind in ['catAx','valAx']:
        axis=plot.find('c:'+kind,NS)
        if name!='chart-text-inherited' or kind=='catAx':
            tx=text(axis,size=1200 if name=='chart-text-italic' else 900,font='Arial' if name=='chart-text-italic' else '+mn-lt',italic=int(name=='chart-text-italic'),color='003399' if name=='chart-text-italic' else '000000',rot='-60000000' if name in ['chart-metadata-auto','chart-metadata-order'] else '0')
            axis.remove(tx);axis.insert(list(axis).index(axis.find('c:crossAx',NS)),tx)
        if kind=='catAx':add(axis,'c:noMultiLvlLbl',val=0)
    external=add(chart,'c:externalData');external.set('{'+R+'}id','workbook');add(external,'c:autoUpdate',val=0)
    rel=E.Element('{'+P+'}Relationships',nsmap={None:P});E.SubElement(rel,'{'+P+'}Relationship',Id='workbook',Type=R+'/package',Target='../embeddings/chart-data.xlsx')
    types=E.fromstring(parts['[Content_Types].xml']);E.SubElement(types,'{'+CT+'}Default',Extension='xlsx',ContentType='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
    parts['[Content_Types].xml']=xml(types);parts['word/charts/_rels/chart1.xml.rels']=xml(rel);parts['word/embeddings/chart-data.xlsx']=workbook();parts['word/charts/chart1.xml']=xml(chart)
    destination=root/('tests/fixtures/chart-metadata' if name=='chart-metadata-order' else 'public/fixtures')/f'{name}.docx'
    destination.parent.mkdir(parents=True,exist_ok=True)
    with ZipFile(destination,'w',ZIP_DEFLATED) as z:
        for path,data in parts.items():z.writestr(path,data)
