"""Original OOXML controls for word-wise caret navigation; no document engine."""
import argparse
import json
from pathlib import Path
from manual_break_wrapping_fixture import make, paragraph, run, write, NS

DEFAULT=Path(__file__).resolve().parents[1]/'tests/fixtures/native-navigation'
TEXTS=['Alpha beta gamma','Alpha   beta','Alpha, beta.','Alpha...beta!',
       'one-two_three/four',"don't stop",'12.5 kg','alpha\tbeta',
       'alpha\u00a0beta','alpha\vbeta','e\u0301lan café','Alpha 😀 beta',
       '中文 words','αβγ δεζ','  Alpha beta  ', 'Wait?!? yes',
       '“quoted” words', 'one\u2011two', 'one\u00adtwo', 'a\u2002b',
       'a\u2003b', 'a/b.c+d=e', 'a—b–c', '😀😀 next', '👩‍💻 next']

def build(output):
    output.mkdir(parents=True,exist_ok=True)
    body=[]
    for text in TEXTS:
        contents=''.join(run(contents='<w:tab/>') if c=='\t' else run(contents='<w:br/>') if c=='\v' else run(c).replace('<w:t>', '<w:t xml:space="preserve">') for c in text)
        body.append(paragraph(drawings=contents))
    parts=make(15)
    section='<w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:left="1440" w:right="1440" w:bottom="1440" w:header="720" w:footer="720" w:gutter="0"/>'
    parts['word/document.xml']=f'<w:document {NS}><w:body>{"".join(body)}<w:sectPr>{section}</w:sectPr></w:body></w:document>'
    write(output/'control.docx',parts)
    (output/'cases.json').write_text(json.dumps(TEXTS,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')

if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output',type=Path,default=DEFAULT)
    build(parser.parse_args().output)
