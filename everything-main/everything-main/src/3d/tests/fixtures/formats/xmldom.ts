// Minimal XML DOM (test-only) so three's ColladaParser can run under Node.
class XText {
  nodeType = 3;
  nodeName = '#text';
  parentElement: XElement | null = null;
  constructor(public textContent: string) {}
}
class XElement {
  nodeType = 1;
  childNodes: (XElement | XText)[] = [];
  parentElement: XElement | null = null;
  attrs = new Map<string, string>();
  constructor(public nodeName: string) {}
  get tagName() {
    return this.nodeName;
  }
  get localName() {
    return this.nodeName;
  }
  get children() {
    return this.childNodes.filter((c): c is XElement => c.nodeType === 1);
  }
  get attributes() {
    return [...this.attrs].map(([name, value]) => ({ name, value, nodeName: name, nodeValue: value }));
  }
  getAttribute(n: string) {
    return this.attrs.has(n) ? this.attrs.get(n)! : null;
  }
  hasAttribute(n: string) {
    return this.attrs.has(n);
  }
  get textContent(): string {
    return this.childNodes.map((c) => c.textContent).join('');
  }
  getElementsByTagName(tag: string): XElement[] {
    const out: XElement[] = [];
    const walk = (e: XElement) => {
      for (const c of e.children) {
        if (tag === '*' || c.nodeName === tag) out.push(c);
        walk(c);
      }
    };
    walk(this);
    return out;
  }
  querySelector(sel: string): XElement | null {
    const m = /^\[(\w+)="([^"]*)"\]$/.exec(sel);
    const all = this.getElementsByTagName('*');
    if (m) return all.find((e) => e.getAttribute(m[1]) === m[2]) ?? null;
    return all.find((e) => e.nodeName === sel) ?? null;
  }
}

function decode(s: string) {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

export class MiniDOMParser {
  parseFromString(text: string) {
    const doc = new XElement('#document');
    const stack: XElement[] = [doc];
    const re = /<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<!\[CDATA\[([\s\S]*?)\]\]>|<(\/?)([\w:.-]+)((?:\s+[\w:.-]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>|([^<]+)/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text))) {
      const top = stack[stack.length - 1];
      if (m[1] !== undefined) top.childNodes.push(Object.assign(new XText(m[1]), { parentElement: top }));
      else if (m[3]) {
        if (m[2]) {
          stack.pop();
          continue;
        }
        const el = new XElement(m[3]);
        el.parentElement = top === doc ? null : top;
        for (const a of m[4].matchAll(/([\w:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) el.attrs.set(a[1], decode(a[2] ?? a[3] ?? ''));
        top.childNodes.push(el);
        if (!m[5]) stack.push(el);
      } else if (m[6] !== undefined) top.childNodes.push(Object.assign(new XText(decode(m[6])), { parentElement: top }));
    }
    return Object.assign(doc, {
      documentElement: doc.children[0],
    });
  }
}
