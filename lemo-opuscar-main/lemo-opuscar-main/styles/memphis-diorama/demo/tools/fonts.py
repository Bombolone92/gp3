"""Subset the film's fonts to the characters it uses (Google Fonts CSS2 API, &text=), all OFL.
usage: python -I tools/fonts.py <demo_dir>  -> fonts/*.woff2 + fonts/fonts.css + fonts/OFL-*.txt"""
import sys, os, re, ssl, urllib.request, urllib.parse
D = sys.argv[1]
main = open(os.path.join(D, 'main.js'), encoding='utf-8').read()
src = main[main.index('const TEXT = ['):main.index('const TITLE')] + main[main.index('const TITLE'):].split('\n', 1)[0]  # only the on-screen strings
cjk = sorted(set(re.findall(r'[　-〿一-鿿＀-￯·°×]', src)))
latin = ''.join(chr(c) for c in range(32, 127))
text = ''.join(cjk) + latin
print(len(cjk), 'CJK chars')
UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36'
try:
    import certifi
    CTX = ssl.create_default_context(cafile=certifi.where())
except ImportError:
    CTX = ssl.create_default_context()
get = lambda url: urllib.request.urlopen(urllib.request.Request(url, headers={'User-Agent': UA}), timeout=60, context=CTX).read()
os.makedirs(os.path.join(D, 'fonts'), exist_ok=True)
css = []
for fam, w, alias, out in (('Noto Sans SC', 400, 'SC', 'NotoSansSC-400.woff2'), ('Noto Sans SC', 600, 'SC', 'NotoSansSC-600.woff2'),
                           ('Inter Tight', 400, 'IT', 'InterTight-400.woff2'), ('Inter Tight', 600, 'IT', 'InterTight-600.woff2'),
                           ('IBM Plex Mono', 400, 'PM', 'IBMPlexMono-400.woff2')):
    c = get('https://fonts.googleapis.com/css2?family=' + urllib.parse.quote(fam) + f':wght@{w}&text=' + urllib.parse.quote(text)).decode()
    urls = re.findall(r'url\((https://[^)]+)\)', c)
    assert len(urls) == 1, c[:400]
    data = get(urls[0]); open(os.path.join(D, 'fonts', out), 'wb').write(data)
    css.append(f"@font-face{{font-family:'{alias}';src:url({out}) format('woff2');font-weight:{w}}}")
    print(out, len(data), 'bytes')
open(os.path.join(D, 'fonts', 'fonts.css'), 'w').write('\n'.join(css) + '\n')
# licence texts from github.com/google/fonts (ofl/<family>/OFL.txt)
for fam, out in (('notosanssc', 'OFL-notosanssc.txt'), ('intertight', 'OFL-intertight.txt'), ('ibmplexmono', 'OFL-ibmplexmono.txt')):
    open(os.path.join(D, 'fonts', out), 'wb').write(get(f'https://raw.githubusercontent.com/google/fonts/main/ofl/{fam}/OFL.txt'))
