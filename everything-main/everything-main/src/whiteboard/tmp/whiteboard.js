function ee(e) {
  if (typeof e != "string" || !e || e.length > 64) return null;
  try {
    const t = Intl.getCanonicalLocales(e)[0];
    return t && t.length <= 64 ? t : null;
  } catch {
    return null;
  }
}
function xe(e, t = !1) {
  if (typeof e != "string" || (e = e.trim(), !e || e.length > 2048 || /[\s\u0000-\u001f\u007f]/u.test(e)) || (t && !/^[a-z][a-z\d+.-]*:(?!\d)/i.test(e) && (e = `https://${e}`), !/^https?:\/\//i.test(e))) return null;
  try {
    const n = new URL(e);
    return ["http:", "https:"].includes(n.protocol) && n.hostname && n.href.length <= 2048 ? n.href : null;
  } catch {
    return null;
  }
}
function on(e = "", t = []) {
  const n = [];
  for (const r of t) {
    const a = xe(r.style.link);
    if (!a) continue;
    const o = n.at(-1);
    o?.end === r.start && o.url === a ? (o.end = r.end, o.text += e.slice(r.start, r.end)) : n.push({
      start: r.start,
      end: r.end,
      url: a,
      text: e.slice(r.start, r.end)
    });
  }
  return n;
}
function zt(e, t, n, r = n) {
  const a = on(e, t);
  if (n === r) {
    const s = a.find((c) => c.start <= n && c.end > n) || a.find(
      (c) => c.end === n && !/[\n\u2028]/.test(e[n - 1] || "")
    );
    return s ? { ...s } : { start: n, end: r, url: "" };
  }
  const o = a.find((s) => s.start <= n && s.end >= r);
  return { start: n, end: r, url: o?.url || "" };
}
function sn(e = "#30342f") {
  const t = /^#([\da-f]{2})([\da-f]{2})([\da-f]{2})$/i.exec(e);
  return t && Number.parseInt(t[1], 16) * 0.2126 + Number.parseInt(t[2], 16) * 0.7152 + Number.parseInt(t[3], 16) * 0.0722 > 160 ? "#8ab4f8" : "#155db1";
}
const ht = 7, ln = (e) => e && typeof e == "object" && !Array.isArray(e) && ["bullet", "number"].includes(e.list) && Number.isInteger(e.indent) && e.indent >= 0 && e.indent <= ht && Object.keys(e).every((t) => ["list", "indent"].includes(t));
function cn(e, t) {
  if (t === void 0) return;
  if (!Array.isArray(t) || t.length > e.length + 1)
    throw Error("Invalid text list.");
  let n = -1;
  for (const r of t) {
    if (!r || Object.keys(r).some(
      (a) => !["start", "list", "indent"].includes(a)
    ) || !Number.isInteger(r.start) || r.start <= n || r.start > e.length || r.start !== 0 && e[r.start - 1] !== `
` || !ln({ list: r.list, indent: r.indent }))
      throw Error("Invalid text list.");
    n = r.start;
  }
}
function Ae(e, t = []) {
  const n = new Map(t.map((o) => [o.start, o])), r = [];
  let a = 0;
  for (const o of e.split(`
`)) {
    const s = n.get(a), c = a + o.length;
    r.push({
      start: a,
      end: c,
      text: o,
      ...s ? { list: s.list, indent: s.indent } : {}
    }), a = c + 1;
  }
  return r;
}
function gt(e, t) {
  const n = [], r = [];
  return Ae(e, t).map((a) => {
    if (!a.list)
      return n.length = r.length = 0, a;
    const o = a.indent;
    return n.length = r.length = o + 1, n[o] = r[o] === a.list ? (n[o] || 0) + 1 : 1, r[o] = a.list, {
      ...a,
      marker: a.list === "number" ? `${n[o]}.` : ["•", "◦", "▪"][o % 3]
    };
  });
}
function Mt(e, t, n) {
  const r = n === 0 ? 0 : e.lastIndexOf(`
`, n - 1) + 1;
  return t?.find((a) => a.start === r);
}
function Pe(e, t, n, r) {
  const a = r > n ? r - 1 : r;
  return Ae(e, t).filter(
    (o) => o.start <= a && o.end >= n
  );
}
function At(e, t = [], n, r, a) {
  const o = new Set(
    Pe(e, t, n, r).map((s) => s.start)
  );
  return Ae(e, t).flatMap((s) => {
    const c = o.has(s.start) ? a : s.list;
    return c ? [{ start: s.start, list: c, indent: s.indent || 0 }] : [];
  });
}
function un(e, t, n, r, a) {
  const o = Ae(e, t), s = new Set(
    Pe(e, t, n, r).map((d) => d.start)
  );
  let c;
  for (const d of o)
    s.has(d.start) && d.list ? c = d.indent : d.list && c !== void 0 && d.indent > c ? s.add(d.start) : c = void 0;
  let l = !0;
  for (let d = 0; d < o.length; d++) {
    const C = o[d];
    !C.list || !s.has(C.start) || (a > 0 && (C.indent >= ht || !o[d - 1]?.list || !s.has(o[d - 1].start) && C.indent > o[d - 1].indent) && (l = !1), a < 0 && C.indent === 0 && (l = !1));
  }
  return l ? o.filter((d) => d.list).map((d) => ({
    start: d.start,
    list: d.list,
    indent: d.indent + (s.has(d.start) ? a : 0)
  })) : t || [];
}
function qe(e, t = [], n, r, a) {
  const o = e.slice(0, n) + a + e.slice(r), s = a.length - r + n, c = Ae(e, t), l = new Map(c.map((C) => [C.end, C])), d = c.find((C) => C.start <= n && C.end >= n);
  return Ae(o).flatMap((C) => {
    let f;
    return C.end === o.length ? f = r === e.length ? d : c.at(-1) : C.end < n ? f = l.get(C.end) : C.end >= n + a.length ? f = l.get(C.end - s) : f = d, f?.list ? [{ start: C.start, list: f.list, indent: f.indent }] : [];
  });
}
function dn(e, t) {
  return gt(e, t).map((n) => {
    const r = n.list ? `${"  ".repeat(n.indent)}${n.marker} ` : "";
    return r + n.text.replace(/\u2028/g, `
${" ".repeat(r.length)}`);
  }).join(`
`);
}
function pn(e, t, n, r) {
  const a = e.createElement("div"), o = [];
  for (const s of gt(t, n)) {
    let c;
    if (!s.list)
      o.length = 0, c = e.createElement("p"), a.append(c);
    else {
      const l = Math.min(s.indent, o.length);
      if (o.length = Math.min(o.length, l + 1), !o[l] || o[l].kind !== s.list) {
        const d = e.createElement(s.list === "number" ? "ol" : "ul");
        (l ? o[l - 1].item : a).append(d), o[l] = { kind: s.list, list: d };
      }
      c = e.createElement("li"), o[l].list.append(c), o[l].item = c;
    }
    r ? r(c, s.text, s.start) : s.text.split("\u2028").forEach((l, d) => {
      d && c.append(e.createElement("br")), c.append(e.createTextNode(l));
    });
  }
  return a.innerHTML;
}
function mn(e, t) {
  if (!t || t.length > 1e6) return null;
  const n = e.createElement("template");
  n.innerHTML = t;
  const r = [...n.content.childNodes].map((b) => [b, 0]);
  let a = 0;
  for (; r.length; ) {
    const [b, h] = r.pop();
    if (++a > 4e4 || h > 64) return null;
    for (const p of b.childNodes) r.push([p, h + 1]);
  }
  if (!n.content.querySelector("ol,ul,a[href],[lang]")) return null;
  const o = [];
  let s = 0;
  const c = /* @__PURE__ */ new Set([
    "SCRIPT",
    "STYLE",
    "NOSCRIPT",
    "IFRAME",
    "OBJECT",
    "TEMPLATE"
  ]), l = (b) => {
    let h = "";
    const p = [], x = (k, P, R) => {
      const L = h.length;
      if (h += k.replace(/\r\n?/g, `
`).replace(/\n/g, "\u2028"), !P && !R || L === h.length) return;
      const G = p.at(-1);
      G?.end === L && G.style.link === P && G.style.lang === R ? G.end = h.length : p.push({
        start: L,
        end: h.length,
        style: { ...P ? { link: P } : {}, ...R ? { lang: R } : {} }
      });
    }, M = (k, P, R) => {
      if (k.nodeType === 3) return x(k.data, P, R);
      if (!(k.nodeType !== 1 || c.has(k.tagName) || ["OL", "UL"].includes(k.tagName))) {
        if (R = ee(k.getAttribute("lang")) || R, k.tagName === "BR") return x("\u2028", P, R);
        k.tagName === "A" && (P = xe(k.getAttribute("href"))), [...k.childNodes].forEach((L, G) => {
          G && ["DIV", "P"].includes(L.tagName) && x("\u2028", P, R), M(L, P, R);
        });
      }
    };
    return Array.isArray(b) ? b.forEach((k) => M(k)) : M(b), { text: h, runs: p };
  }, d = (b, h, p = 0) => {
    if (s > 2e4) return;
    let x = typeof b == "string" ? b : b.text;
    x = x.replace(/\r\n?/g, `
`).replace(/\n/g, "\u2028"), x = x.slice(0, 2e4 - s), /[\uD800-\uDBFF]$/.test(x) && (x = x.slice(0, -1));
    const M = (b.runs || []).filter((k) => k.start < x.length).map((k) => ({ ...k, end: Math.min(k.end, x.length) }));
    o.push({ text: x, list: h, indent: p, runs: M }), s += x.length + 1;
  }, C = (b, h = 0) => {
    if (!(s > 2e4 || b.nodeType !== 1 || c.has(b.tagName)))
      if (["OL", "UL"].includes(b.tagName)) {
        for (const p of b.children)
          if (p.tagName === "LI") {
            d(
              l(p),
              b.tagName === "OL" ? "number" : "bullet",
              Math.min(h, ht)
            );
            for (const x of p.querySelectorAll("ol,ul"))
              x.closest("li") === p && C(x, h + 1);
          }
      } else if (b.querySelector("ol,ul"))
        f(b, h);
      else {
        const p = l(b);
        (p.text || b.tagName === "P") && d(p);
      }
  }, f = (b, h = 0) => {
    let p = [];
    const x = () => {
      const M = l(p);
      (M.text.trim() || M.text.includes("\u2028")) && d(M), p = [];
    };
    for (const M of [...b.childNodes])
      M.nodeType === 1 && (/^(DIV|P|OL|UL|H[1-6]|SECTION|ARTICLE|BLOCKQUOTE)$/.test(
        M.tagName
      ) || M.querySelector("ol,ul")) ? (x(), C(M, h)) : p.push(M);
    x();
  };
  if (f(n.content), !o.length) return null;
  let S = 0;
  const j = [], D = [];
  for (const b of o) {
    b.list && j.push({ start: S, list: b.list, indent: b.indent });
    for (const h of b.runs)
      D.push({ ...h, start: S + h.start, end: S + h.end });
    S += b.text.length + 1;
  }
  return {
    text: o.map((b) => b.text).join(`
`),
    blocks: j,
    ...D.length ? { runs: D } : {}
  };
}
const Ye = [
  "bold",
  "italic",
  "underline",
  "strike",
  "textColor",
  "highlight",
  "link",
  "lang"
], fn = /* @__PURE__ */ new Set(["textColor", "highlight"]), hn = (e, t) => Ye.every((n) => e[n] === t[n]);
function gn(e) {
  return e && typeof e == "object" && !Array.isArray(e) && Object.entries(e).every(
    ([t, n]) => Ye.includes(t) && (t === "lang" ? !!ee(n) : t === "link" ? typeof n == "string" && !!xe(n) : fn.has(t) ? n === !1 || /^#[\da-f]{6}$/i.test(n) && typeof n == "string" : typeof n == "boolean")
  );
}
function De(e, t) {
  return !(t > 0 && t < e.length && /[\uD800-\uDBFF]/.test(e[t - 1]) && /[\uDC00-\uDFFF]/.test(e[t]));
}
function bt(e, t) {
  if (t === void 0) return;
  if (!Array.isArray(t) || t.length > e.length)
    throw Error("Invalid text formatting.");
  let n = 0;
  for (const r of t) {
    if (!r || Object.keys(r).some((a) => !["start", "end", "style"].includes(a)) || !Number.isInteger(r.start) || !Number.isInteger(r.end) || r.start < n || r.end <= r.start || r.end > e.length || !De(e, r.start) || !De(e, r.end) || !gn(r.style))
      throw Error("Invalid text formatting.");
    n = r.end;
  }
}
function ie(e, t, n, r) {
  if (n <= t || !Object.keys(r).length) return;
  const a = e.at(-1);
  a?.end === t && hn(a.style, r) ? a.end = n : e.push({ start: t, end: n, style: { ...r } });
}
function Le(e, t = []) {
  const n = [];
  let r = 0;
  for (const { start: a, end: o, style: s } of t) {
    if (a >= e.length) break;
    a > r && n.push({
      start: r,
      end: a,
      text: e.slice(r, a),
      style: {}
    }), n.push({
      start: a,
      end: Math.min(o, e.length),
      text: e.slice(a, o),
      style: s
    }), r = o;
  }
  return r < e.length && n.push({
    start: r,
    end: e.length,
    text: e.slice(r),
    style: {}
  }), n;
}
function Ee(e = [], t, n = !0) {
  return e.find(
    (r) => n && t > 0 ? r.start < t && r.end >= t : r.start <= t && r.end > t
  )?.style || {};
}
function ct(e, t, n, r, a) {
  const o = [];
  for (const s of Le(e, t)) {
    const c = Math.max(n, s.start), l = Math.min(r, s.end);
    if (c >= l) ie(o, s.start, s.end, s.style);
    else {
      ie(o, s.start, c, s.style);
      const d = { ...s.style };
      for (const [C, f] of Object.entries(a))
        f == null ? delete d[C] : d[C] = f;
      ie(o, c, l, d), ie(o, l, s.end, s.style);
    }
  }
  return o;
}
function ut(e, t) {
  let n = 0, r = 0;
  for (; n < e.length && n < t.length && e[n] === t[n]; )
    n++;
  for ((!De(e, n) || !De(t, n)) && n--; r < e.length - n && r < t.length - n && e.at(-r - 1) === t.at(-r - 1); )
    r++;
  return (!De(e, e.length - r) || !De(t, t.length - r)) && r--, {
    start: n,
    end: e.length - r,
    insert: t.slice(n, t.length - r)
  };
}
function Te(e = [], t, n, r, a = Ee(e, t), o) {
  const s = [], c = r.length - (n - t);
  for (const l of e)
    ie(s, l.start, Math.min(t, l.end), l.style);
  if (o)
    for (const l of o) {
      if (l.start >= r.length) break;
      ie(
        s,
        t + l.start,
        t + Math.min(r.length, l.end),
        l.style
      );
    }
  else ie(s, t, t + r.length, a);
  for (const l of e)
    ie(s, Math.max(n, l.start) + c, l.end + c, l.style);
  return s;
}
function dt(e, t, n) {
  const { start: r, end: a, insert: o } = ut(e, t);
  return Te(n, r, a, o);
}
function nt(e = [], t, n) {
  const r = [];
  let a = 0, o = e.length;
  for (; a < o; ) {
    const s = a + o >>> 1;
    e[s].end <= t ? a = s + 1 : o = s;
  }
  for (let s = a; s < e.length && e[s].start < n; s++) {
    const c = e[s];
    ie(
      r,
      Math.max(t, c.start) - t,
      Math.min(n, c.end) - t,
      c.style
    );
  }
  return r;
}
const Gt = (e, t) => `${e},${t}`;
function jt(e) {
  const t = /^(0|[1-9]\d?),(0|[1-9]\d?)$/.exec(e);
  return !t || +t[1] >= 20 || +t[2] >= 12 ? null : { r: +t[1], c: +t[2] };
}
const bn = (e) => e && typeof e == "object" && !Array.isArray(e);
function vn(e, t) {
  if (!bn(t) || Object.keys(t).some((n) => !["lang", "textRuns"].includes(n)) || t.lang !== void 0 && !ee(t.lang) || (bt(e, t.textRuns), t.textRuns?.some(
    (n) => Object.keys(n.style).some((r) => r !== "lang")
  )))
    throw Error("Invalid table cell language.");
}
function Ze(e, t = {}) {
  vn(e, t);
  const n = ee(t.lang), r = [];
  for (const a of t.textRuns || []) {
    const o = ee(a.style.lang);
    o && ie(r, a.start, a.end, { lang: o });
  }
  return {
    ...n ? { lang: n } : {},
    ...r.length ? { textRuns: r } : {}
  };
}
function Fe(e, t, n, r = !0) {
  const a = e.cells[t][n], o = Ze(
    a,
    e.cellLanguages?.[Gt(t, n)]
  ), s = o.lang ?? (r && ee(e.lang));
  return { text: a, ...o, ...s ? { lang: s } : {} };
}
function Jt(e, t, n, r = {}) {
  const a = {};
  for (const [o, s] of Object.entries(e.cellLanguages || {})) {
    const c = jt(o);
    if (!c) continue;
    let { r: l, c: d } = c;
    if (n) {
      const j = n.axis === "row" ? l : d;
      if (j >= n.index && j < n.index + n.remove)
        continue;
      const D = j >= n.index + n.remove ? n.insert - n.remove : 0;
      n.axis === "row" ? l += D : d += D;
    }
    const C = t[l]?.[d];
    if (typeof C != "string") continue;
    const f = structuredClone(s);
    f.textRuns && e.cells[c.r]?.[c.c] !== C && (f.textRuns = dt(
      e.cells[c.r][c.c],
      C,
      f.textRuns
    ));
    const S = Ze(C, f);
    Object.keys(S).length && (a[Gt(l, d)] = S);
  }
  for (const [o, s] of Object.entries(r)) {
    const c = jt(o), l = c && t[c.r]?.[c.c];
    if (typeof l != "string") throw Error("Invalid table cell languages.");
    const d = Ze(l, s);
    Object.keys(d).length ? a[o] = d : delete a[o];
  }
  return {
    cells: t,
    cellLanguages: Object.keys(a).length ? a : void 0
  };
}
function yn(e, t, n, r) {
  return pn(e, t, r, (a, o, s) => {
    for (const c of Le(
      o,
      nt(n, s, s + o.length)
    )) {
      const l = xe(c.style.link), d = e.createElement(l ? "a" : "span");
      l && (d.href = l, d.rel = "noopener noreferrer"), c.style.bold && (d.style.fontWeight = "600"), c.style.italic && (d.style.fontStyle = "italic"), d.style.textDecoration = [
        c.style.underline && "underline",
        c.style.strike && "line-through"
      ].filter(Boolean).join(" "), c.style.textColor && (d.style.color = c.style.textColor), c.style.highlight && (d.style.backgroundColor = c.style.highlight), c.style.lang && (d.lang = c.style.lang), c.text.split("\u2028").forEach((C, f) => {
        f && d.append(e.createElement("br")), d.append(e.createTextNode(C));
      }), a.append(d);
    }
  });
}
const pt = 2e4, Ve = "application/x-whiteboard-text";
function ot(e, t = pt) {
  let n = e.slice(0, Math.max(0, t));
  return /[\uD800-\uDBFF]$/.test(n) && /[\uDC00-\uDFFF]/.test(e[n.length] || "") && (n = n.slice(0, -1)), n;
}
function Cn(e, t, {
  onSelection: n = () => {
  },
  history: r,
  plainTextOnly: a = !1,
  maxLength: o = pt,
  multiline: s = !0,
  inheritLanguage: c = !0
} = {}) {
  const l = e.createElement("div");
  l.dataset.userContent = "", l.contentEditable = "true", l.setAttribute("contenteditable", "true"), l.setAttribute("role", "textbox"), l.setAttribute("aria-multiline", String(s));
  const d = (i) => s ? i : i.replace(/[\r\n]/g, ""), C = t.text || "";
  let f = d(C), S = f === C ? t.textRuns || [] : dt(C, f, t.textRuns), j = a ? [] : t.textBlocks || [], D = t, b = "#30342f", h = { start: 0, end: f.length, direction: "forward" }, p, x = !1, M, k, P = [], R = [], L = 0, G = !1, H, te, se, fe = 0, Ue;
  const je = (i = {}) => a ? {
    lang: i.lang || D.lang
  } : {
    bold: D.bold ?? D.type === "frame",
    italic: !!D.italic,
    underline: !!D.underline,
    strike: !!D.strike,
    ...D.textColor ? { textColor: D.textColor } : {},
    ...D.highlight ? { highlight: D.highlight } : {},
    ...D.lang ? { lang: D.lang } : {},
    ...i
  };
  function Q() {
    if (H) return H;
    let i = "", m = !1;
    const g = /* @__PURE__ */ new WeakMap(), w = (A) => {
      if (A.nodeType === 3) {
        g.set(A, i.length), i += A.data;
        return;
      }
      if (A.nodeType !== 1) return;
      if (A.hasAttribute("data-editor-tail")) {
        g.set(A, [i.length]);
        return;
      }
      if (A.tagName === "BR") {
        g.set(A, [i.length]), i += `
`;
        return;
      }
      A.hasAttribute("data-paragraph") && (m && (i += `
`), m = !0), A !== l && !A.hasAttribute("data-paragraph") && !A.hasAttribute("data-list-group") && ["DIV", "P"].includes(A.tagName) && i && !i.endsWith(`
`) && (i += `
`);
      const I = [i.length];
      for (const F of A.childNodes)
        w(F), I.push(i.length);
      g.set(A, I);
    };
    return w(l), H = { text: i, positions: g };
  }
  function u() {
    const i = e.getSelection();
    if (i?.anchorNode && l.contains(i.anchorNode) && l.contains(i.focusNode)) {
      const { positions: m } = Q(), g = (E, I) => {
        const F = m.get(E);
        return Math.min(
          f.length,
          Math.max(
            0,
            typeof F == "number" ? F + I : F?.[I] ?? f.length
          )
        );
      }, w = g(i.anchorNode, i.anchorOffset), A = g(i.focusNode, i.focusOffset);
      h = {
        start: Math.min(w, A),
        end: Math.max(w, A),
        direction: w > A ? "backward" : "forward"
      };
    }
    return h;
  }
  function v(i, m = i, g = "forward", w = !1) {
    if (i = Math.max(0, Math.min(f.length, i)), m = Math.max(i, Math.min(f.length, m)), h = { start: i, end: m, direction: g }, !l.isConnected) return;
    w && l.focus({ preventScroll: !0 });
    const { positions: A } = Q(), E = [], I = e.createTreeWalker(l, 4);
    for (; I.nextNode(); )
      typeof A.get(I.currentNode) == "number" && E.push(I.currentNode);
    const F = (Ke) => {
      for (const ge of E) {
        const be = A.get(ge);
        if (Ke >= be && Ke <= be + ge.length) return [ge, Ke - be];
      }
      for (const ge of l.querySelectorAll("[data-paragraph]"))
        if (A.get(ge)?.[0] === Ke) {
          const be = ge.querySelector("[data-editor-tail]");
          return be ? [be.parentNode, [...be.parentNode.childNodes].indexOf(be)] : [ge, ge.childNodes.length];
        }
      return [l, 0];
    }, q = F(i), B = F(m), re = e.getSelection();
    g === "backward" ? re.setBaseAndExtent(...B, ...q) : re.setBaseAndExtent(...q, ...B);
  }
  function z() {
    if (x) return;
    G = !0;
    const i = e.activeElement === l, m = { ...h }, g = e.createDocumentFragment(), w = (A, E, I) => {
      for (const F of Le(E, I)) {
        const q = e.createElement(
          !a && F.style.link ? "a" : "span"
        ), B = je(F.style);
        B.link && (q.href = xe(B.link), q.dataset.textLink = "", q.target = "_blank", q.rel = "noopener noreferrer", q.tabIndex = -1), q.style.fontWeight = B.bold ? "600" : "400", q.style.fontStyle = B.italic ? "italic" : "normal", q.style.textDecoration = [(B.underline || B.link) && "underline", B.strike && "line-through"].filter(Boolean).join(" ") || "none", (B.textColor !== void 0 || B.link) && (q.style.color = B.textColor || (B.link ? sn(b) : b)), B.highlight && (q.style.backgroundColor = B.highlight), B.lang && (q.lang = B.lang), q.textContent = F.text, A.append(q);
      }
      if (!E || E.endsWith(`
`) || E.endsWith("\u2028")) {
        const F = e.createElement("br");
        F.setAttribute("data-editor-tail", ""), A.append(F);
      }
    };
    if (!j.length) w(g, f, S);
    else {
      let A;
      for (const E of gt(f, j)) {
        const I = e.createElement("div");
        I.setAttribute("data-paragraph", ""), I.style.minHeight = "1.35em", E.list ? (A || (A = e.createElement("div"), A.setAttribute("role", "list"), A.setAttribute("data-list-group", ""), g.append(A)), I.setAttribute("role", "listitem"), I.setAttribute("aria-level", String(E.indent + 1)), I.dataset.indent = E.indent, I.style.position = "relative", I.style.marginLeft = `${(E.indent + 1) * 1.5}em`, I.dataset.listMarker = E.marker, A.append(I)) : (A = null, g.append(I)), w(
          I,
          E.text,
          nt(S, E.start, E.end)
        );
      }
    }
    l.replaceChildren(g), fe++, H = void 0, i && v(m.start, m.end, m.direction), G = !1;
  }
  const y = () => ({
    value: f,
    runs: S,
    blocks: j,
    selection: { ...u() },
    pending: p,
    inheritLanguage: c
  });
  function T(i = !1) {
    if (r) return;
    const m = Date.now();
    (!i || m - L > 500 || R.length) && (P.push(y()), P.length > 100 && P.shift()), R = [], L = i ? m : 0;
  }
  const O = () => l.dispatchEvent(new e.defaultView.Event("input", { bubbles: !0 }));
  function J(i) {
    f = i.value, S = i.runs, j = i.blocks, p = i.pending, c = i.inheritLanguage, h = i.selection, z(), v(h.start, h.end, h.direction, !0), O(), n();
  }
  function X(i) {
    if (r) {
      r(i);
      return;
    }
    const m = i ? R : P, g = i ? P : R;
    m.length && (g.push(y()), J(m.pop()), L = 0);
  }
  function K(i, m, g = !0, w, A = !1) {
    const { start: E, end: I } = u();
    if (i = ot(
      d(i.replace(/\r\n?/g, `
`)),
      o - f.length + I - E
    ), !(!i && E === I)) {
      if (g && T(A), S = Te(
        S,
        E,
        I,
        i,
        Z(E, I, i),
        m
      ), j = qe(f, j, E, I, i), f = f.slice(0, E) + i + f.slice(I), w) {
        const F = new Map(j.map((q) => [q.start, q]));
        for (const q of Ae(i, w)) {
          const B = E + q.start, re = B === 0 ? 0 : f.lastIndexOf(`
`, B - 1) + 1;
          q.list ? F.set(re, {
            start: re,
            list: q.list,
            indent: q.indent
          }) : (q.start > 0 || B === re && i.includes(`
`)) && F.delete(re);
        }
        j = [...F.values()].sort((q, B) => q.start - B.start);
      }
      h = {
        start: E + i.length,
        end: E + i.length,
        direction: "forward"
      }, z(), v(h.start, h.end, "forward", !0), O(), n();
    }
  }
  function Z(i, m, g) {
    let w = p || Ee(S, i, i === m);
    if (!c) {
      const { lang: A, ...E } = w;
      w = E;
    }
    if (w.link && (/[\n\u2028]/.test(g) || i === m && /^\s/.test(g) && zt(f, S, i).end === i)) {
      const { link: A, ...E } = w;
      return p && (p = E), E;
    }
    return w;
  }
  l.addEventListener("beforeinput", (i) => {
    if (!(i.isComposing || x))
      if (["historyUndo", "historyRedo"].includes(i.inputType))
        i.preventDefault(), X(i.inputType === "historyRedo");
      else if (["insertParagraph", "insertLineBreak"].includes(i.inputType)) {
        if (i.preventDefault(), !s) return;
        const m = u(), g = Pe(
          f,
          j,
          m.start,
          m.end
        )[0];
        i.inputType === "insertParagraph" && g?.list && !g.text && m.start === m.end ? g.indent ? l.indentList(-1) : l.setList(null) : K(
          i.inputType === "insertLineBreak" && g?.list ? "\u2028" : `
`
        );
      } else if ([
        "formatBold",
        "formatItalic",
        "formatUnderline",
        "formatStrikeThrough"
      ].includes(i.inputType))
        i.preventDefault(), l.format(
          {
            formatBold: "bold",
            formatItalic: "italic",
            formatUnderline: "underline",
            formatStrikeThrough: "strike"
          }[i.inputType]
        );
      else {
        const m = u(), g = Pe(
          f,
          j,
          m.start,
          m.end
        )[0];
        if (i.inputType === "deleteContentBackward" && m.start === m.end && g?.list && m.start === g.start) {
          i.preventDefault(), g.indent ? l.indentList(-1) : l.setList(null);
          return;
        }
        const w = g && f.slice(g.start, m.start);
        if (i.inputType === "insertText" && i.data === " " && !g?.list && m.start === m.end && /^(?:[-*]|1[.)])$/.test(w)) {
          i.preventDefault(), l.dispatchEvent(new e.defaultView.Event("formatboundary")), T(), S = Te(S, g.start, m.start, ""), j = qe(
            f,
            j,
            g.start,
            m.start,
            ""
          ), f = f.slice(0, g.start) + f.slice(m.start), j = At(
            f,
            j,
            g.start,
            g.start,
            w.startsWith("1") ? "number" : "bullet"
          ), h = {
            start: g.start,
            end: g.start,
            direction: "forward"
          }, z(), v(g.start), O(), l.dispatchEvent(new e.defaultView.Event("formatboundary")), n();
          return;
        }
        if (j.length && i.cancelable && i.inputType === "insertText" && i.data !== null) {
          i.preventDefault(), K(
            i.data,
            void 0,
            !0,
            void 0,
            m.start === m.end
          );
          return;
        }
        if (j.length && i.cancelable && i.inputType.startsWith("delete") && m.start !== m.end) {
          i.preventDefault(), K("");
          return;
        }
        M = y(), k = i.inputType, i.data && f.length - (M.selection.end - M.selection.start) + i.data.length > o && (i.preventDefault(), K(i.data));
      }
  });
  function V(i, m = "", g, w) {
    if (!i || i.value !== g) return null;
    const { start: A, end: E } = i.selection, I = g.length - E;
    if (w.length >= A + I && w.startsWith(g.slice(0, A)) && w.endsWith(g.slice(E)))
      return { start: A, end: E, insert: w.slice(A, w.length - I) };
    const F = g.length - w.length;
    if (A !== E || F <= 0 || !m.startsWith("delete"))
      return null;
    const q = m.endsWith("Forward") ? A : A - F;
    return q >= 0 && w === g.slice(0, q) + g.slice(q + F) ? { start: q, end: q + F, insert: "" } : null;
  }
  function le() {
    H = void 0;
    const i = ot(
      d(Q().text),
      o < pt ? Math.max(o, f.length) : o
    );
    if (i === f) return;
    const m = u(), g = V(M, k, f, i) || ut(f, i);
    !r && !x && ((Date.now() - L > 500 || R.length) && P.push(M || y()), P.length > 100 && P.shift(), R = [], L = Date.now()), S = Te(
      S,
      g.start,
      g.end,
      g.insert,
      Z(g.start, g.end, g.insert)
    ), j = qe(
      f,
      j,
      g.start,
      g.end,
      g.insert
    ), f = i;
    const w = e.getSelection(), { positions: A } = Q(), E = (q, B) => typeof A.get(q) == "number" ? A.get(q) + B : A.get(q)?.[B], I = E(w?.anchorNode, w?.anchorOffset), F = E(w?.focusNode, w?.focusOffset);
    h = Number.isFinite(I) && Number.isFinite(F) ? {
      start: Math.min(I, F),
      end: Math.max(I, F),
      direction: I > F ? "backward" : "forward"
    } : m, M = null, z(), n();
  }
  l.addEventListener("input", le), l.addEventListener("compositionstart", () => {
    M = se = y(), x = !0;
  }), l.addEventListener("compositionend", () => {
    le(), !r && se && se.value !== f && (P.push(se), P.length > 100 && P.shift(), R = []), se = void 0, L = 0, x = !1, z(), O();
  }), l.addEventListener("keydown", (i) => {
    if (!(i.isComposing || x || i.keyCode === 229)) {
      if (!s && i.key === "Enter") {
        i.preventDefault(), i.stopPropagation(), !i.metaKey && !i.ctrlKey && !i.altKey && l.closest("form")?.requestSubmit();
        return;
      }
      if (i.key === "Enter" && i.shiftKey && !i.metaKey && !i.ctrlKey && !i.altKey && Mt(f, j, u().start)) {
        i.preventDefault(), i.stopPropagation(), K("\u2028");
        return;
      }
      if (i.key === "Tab" && Mt(f, j, u().start)) {
        i.preventDefault(), i.stopPropagation(), l.indentList(i.shiftKey ? -1 : 1);
        return;
      }
      (i.metaKey || i.ctrlKey) && ["z", "y"].includes(i.key.toLowerCase()) && (i.preventDefault(), i.stopPropagation(), X(i.key.toLowerCase() === "y" || i.shiftKey));
    }
  });
  function he(i) {
    let m = i.getData("text/plain");
    if (a) return { text: m };
    try {
      const w = JSON.parse(i.getData(Ve));
      if (typeof w.text == "string" && (w.plainText ?? w.text) === m && w.text.length <= o)
        return bt(w.text, w.runs), cn(w.text, w.blocks), {
          text: w.text,
          formatting: w.runs,
          paragraphs: w.blocks
        };
    } catch {
    }
    const g = mn(e, i.getData("text/html"));
    return g ? {
      text: g.text,
      paragraphs: g.blocks,
      formatting: g.runs || []
    } : { text: m };
  }
  l.addEventListener("paste", (i) => {
    if (!i.clipboardData) return;
    i.preventDefault(), i.stopPropagation();
    const { text: m, formatting: g, paragraphs: w } = he(i.clipboardData), A = !a && !g?.length && !i.clipboardData.getData(Ve) && xe(m);
    if (A) {
      if (u().start !== u().end) l.setLink(A);
      else {
        const E = m.trim();
        l.dispatchEvent(new e.defaultView.Event("formatboundary")), K(E, [
          {
            start: 0,
            end: E.length,
            style: { ...Ee(S, u().start), link: A }
          }
        ]), l.dispatchEvent(new e.defaultView.Event("formatboundary"));
      }
      return;
    }
    m && K(m, g, !0, w);
  });
  function Se() {
    const { start: i, end: m } = u(), g = f.slice(i, m), w = [];
    for (const E of Le(f, S)) {
      const I = Math.max(i, E.start), F = Math.min(m, E.end);
      I < F && w.push({
        start: I - i,
        end: F - i,
        style: { textColor: !1, highlight: !1, ...je(E.style) }
      });
    }
    const A = Pe(f, j, i, m).filter((E) => E.list).map((E) => ({
      start: Math.max(0, E.start - i),
      list: E.list,
      indent: E.indent
    }));
    return {
      text: g,
      plainText: A.length ? dn(g, A) : g,
      runs: w,
      blocks: A,
      start: i,
      end: m
    };
  }
  for (const i of ["copy", "cut"])
    l.addEventListener(i, (m) => {
      const g = Se();
      if (!(!g.text || !m.clipboardData)) {
        m.preventDefault(), m.stopPropagation();
        try {
          m.clipboardData.setData("text/plain", g.plainText), a || m.clipboardData.setData(Ve, JSON.stringify(g)), !a && (g.blocks.length || g.runs.some((w) => w.style.link || w.style.lang)) && m.clipboardData.setData(
            "text/html",
            yn(e, g.text, g.runs, g.blocks)
          );
        } catch {
          return;
        }
        i === "cut" && K("");
      }
    });
  l.addEventListener("dragstart", (i) => {
    i.dataTransfer && (te = Se(), i.dataTransfer.setData("text/plain", te.plainText), i.dataTransfer.setData(Ve, JSON.stringify(te)), i.dataTransfer.effectAllowed = "copyMove");
  }), l.addEventListener("dragend", () => {
    te = void 0;
  }), l.addEventListener("dragover", (i) => {
    i.preventDefault(), i.stopPropagation();
  }), l.addEventListener("drop", (i) => {
    if (i.preventDefault(), i.stopPropagation(), !i.dataTransfer) return;
    const { text: m, formatting: g, paragraphs: w } = he(i.dataTransfer);
    if (!m) return;
    const A = e.caretPositionFromPoint?.(i.clientX, i.clientY), E = A ? null : e.caretRangeFromPoint?.(i.clientX, i.clientY), I = A?.offsetNode || E?.startContainer, F = A?.offset ?? E?.startOffset;
    I && l.contains(I) && e.getSelection().setBaseAndExtent(I, F, I, F);
    let q = u().start;
    if (te && i.dataTransfer.dropEffect !== "copy" && !i.altKey && !i.ctrlKey) {
      const { start: B, end: re } = te;
      if (q >= B && q <= re) {
        te = void 0;
        return;
      }
      T(), S = Te(S, B, re, ""), j = qe(f, j, B, re, ""), f = f.slice(0, B) + f.slice(re), q > re && (q -= re - B), h = { start: q, end: q, direction: "forward" }, z(), v(q), K(m, g, !1, w);
    } else
      v(q), K(m, g, !0, w);
    te = void 0;
  });
  function St() {
    if (G || x || e.activeElement !== l) return;
    const i = h, m = u();
    (i.start !== m.start || i.end !== m.end) && (p = void 0, L = 0), n();
  }
  e.addEventListener("selectionchange", St), l.destroy = () => e.removeEventListener("selectionchange", St), l.setRichText = (i, m = [], g = []) => {
    h = { ...u() }, f = i, S = m, j = a ? [] : g, p = void 0, z();
  };
  let kt;
  l.setBaseStyle = (i, m = b) => {
    i.lang && (c = !0);
    const g = JSON.stringify([
      i.type,
      m,
      ...Ye.map((w) => i[w])
    ]);
    kt !== g && (h = { ...u() }, D = i, b = m, kt = g, z());
  }, l.rangeStyle = (i) => {
    const { start: m, end: g } = u();
    if (m === g) return je(p || Ee(S, m))[i];
    const w = Le(f, S).filter((A) => A.start < g && A.end > m).map((A) => je(A.style)[i]);
    return w.every((A) => A === w[0]) ? w[0] : "mixed";
  }, l.linkRange = () => {
    const { start: i, end: m } = u();
    return zt(f, S, i, m);
  }, l.setLink = (i) => {
    if (a || x || i && !xe(i)) return !1;
    i = i ? xe(i) : null;
    const { start: m, end: g } = l.linkRange();
    if (m === g && !i) return !1;
    if (l.dispatchEvent(new e.defaultView.Event("formatboundary")), m === g) {
      const w = { ...Ee(S, m), link: i };
      K(i, [{ start: 0, end: i.length, style: w }]);
    } else {
      const w = ct(f, S, m, g, { link: i });
      if (JSON.stringify(w) === JSON.stringify(S)) return !1;
      T(), S = w, z(), v(m, g, "forward", !0), O(), n();
    }
    return p = void 0, l.dispatchEvent(new e.defaultView.Event("formatboundary")), !0;
  }, l.addEventListener("click", (i) => {
    i.target.closest("[data-text-link]") && i.preventDefault();
  });
  function wt(i) {
    if (x || JSON.stringify(i) === JSON.stringify(j)) return;
    const m = { ...u() };
    l.dispatchEvent(new e.defaultView.Event("formatboundary")), T(), j = i, z(), O(), l.dispatchEvent(new e.defaultView.Event("formatboundary")), v(m.start, m.end, m.direction, !0), n();
  }
  return l.listStyle = () => {
    const { start: i, end: m } = u(), g = Pe(f, j, i, m);
    return g.every((w) => w.list === g[0].list) ? g[0].list || !1 : "mixed";
  }, l.setList = (i) => {
    const { start: m, end: g } = u();
    wt(
      At(
        f,
        j,
        m,
        g,
        l.listStyle() === i ? null : i
      )
    );
  }, l.indentList = (i) => {
    const { start: m, end: g } = u();
    wt(un(f, j, m, g, i));
  }, l.setListMetrics = (i, m) => {
    const g = `${fe}:${m.font}`;
    if (Ue !== g) {
      Ue = g, i.font = m.font;
      for (const w of l.querySelectorAll("[data-indent]")) {
        const A = Number(w.dataset.indent) * m.size * 1.5 + Math.max(
          m.size * 1.5,
          i.measureText(w.dataset.listMarker).width + m.size * 0.5
        );
        w.style.marginLeft = `${A}px`;
      }
    }
  }, l.format = (i, m) => {
    if (a && i !== "lang") return;
    if (i === "link") return l.setLink(m);
    if (x || !Ye.includes(i)) return;
    const { start: g, end: w, direction: A } = u();
    m === void 0 && (m = l.rangeStyle(i) !== !0), m === null && ["textColor", "highlight"].includes(i) && (m = !1), g === w ? (i === "lang" && (c = !0), p = { ...p || Ee(S, g) }, m === null ? delete p[i] : p[i] = m) : (l.dispatchEvent(new e.defaultView.Event("formatboundary")), T(), i === "lang" && !c && (p = void 0, c = !0), S = ct(f, S, g, w, { [i]: m }), z(), O(), l.dispatchEvent(new e.defaultView.Event("formatboundary"))), v(g, w, A, !0), n();
  }, Object.defineProperties(l, {
    value: {
      get: () => f,
      set: (i) => {
        if (i = ot(d(String(i)), o), i === f) return;
        h = {
          start: i.length,
          end: i.length,
          direction: "forward"
        };
        const m = ut(f, i);
        S = c ? dt(f, i, S) : Te(
          S,
          m.start,
          m.end,
          m.insert,
          Z(m.start, m.end, m.insert)
        ), j = qe(
          f,
          j,
          m.start,
          m.end,
          m.insert
        ), f = i, z();
      }
    },
    textRuns: { get: () => S },
    textBlocks: { get: () => j },
    defaultTextColor: { get: () => b },
    selectionStart: { get: () => u().start },
    selectionEnd: { get: () => u().end },
    selectionDirection: { get: () => u().direction }
  }), l.setSelectionRange = v, l.select = () => v(0, f.length), z(), l;
}
const ue = "#30342f", _ = "#687169", ke = "#d5dbd0", ve = "#4a5a73", xn = "#3d4450", rt = Math.PI * 2, $ = (e, t) => Math.min(8, e / 4, t / 4);
function Et(e, t) {
  return e < t * 1.5 ? { g: Math.min(e, t) * 0.3, x: 0, gap: 0, right: 0 } : {
    g: Math.min(t * 0.5, e * 0.18),
    x: Math.min(t * 0.35, e * 0.08),
    gap: Math.min(t * 0.2, e * 0.04),
    right: Math.min(t * 0.4, e * 0.08)
  };
}
function ce(e, t = 5) {
  const n = [], r = e.length;
  for (let a = 0; a < r; a++) {
    const [o, s, c = 0] = e[a];
    if (!c) {
      n.push([o, s]);
      continue;
    }
    const [l, d] = e[(a + r - 1) % r], [C, f] = e[(a + 1) % r], S = Math.hypot(l - o, d - s), j = Math.hypot(C - o, f - s);
    if (!S || !j) {
      n.push([o, s]);
      continue;
    }
    const D = Math.min(c, S / 2), b = Math.min(c, j / 2), h = o + (l - o) * D / S, p = s + (d - s) * D / S, x = o + (C - o) * b / j, M = s + (f - s) * b / j, k = Math.max(
      t,
      Math.min(32, Math.ceil(Math.sqrt(Math.max(D, b)) * 3))
    );
    for (let P = 0; P <= k; P++) {
      const R = P / k, L = 1 - R;
      n.push([
        L * L * h + 2 * L * R * o + R * R * x,
        L * L * p + 2 * L * R * s + R * R * M
      ]);
    }
  }
  return n;
}
const pe = (e, t, n, r, a) => ce([
  [e, t, a],
  [e + n, t, a],
  [e + n, t + r, a],
  [e, t + r, a]
]);
function $e(e, t, n, r, a, o, s) {
  const c = [];
  for (let l = 0; l <= s; l++) {
    const d = a + (o - a) * l / s;
    c.push([e + n * Math.cos(d), t + r * Math.sin(d)]);
  }
  return c;
}
const _t = (e, t, n, r, a = 96) => $e(e, t, n, r, 0, rt, a).slice(0, -1), W = ([e, t, n, r], a) => [e + a, t + a, n - a * 2, r - a * 2], Sn = (() => {
  const e = [
    [0.1, 0.62],
    [0.2, 0.32],
    [0.44, 0.16],
    [0.7, 0.2],
    [0.88, 0.42],
    [0.86, 0.74],
    [0.62, 0.86],
    [0.34, 0.86]
  ], t = [];
  e.forEach(([l, d], C) => {
    const [f, S] = e[(C + 1) % e.length], j = (l + f) / 2, D = (d + S) / 2, b = 0.5 + (j - 0.5) * 1.55, h = 0.54 + (D - 0.54) * 1.55;
    for (let p = 0; p < 12; p++) {
      const x = p / 12, M = 1 - x;
      t.push([
        M * M * l + 2 * M * x * b + x * x * f,
        M * M * d + 2 * M * x * h + x * x * S
      ]);
    }
  });
  const n = t.map((l) => l[0]), r = t.map((l) => l[1]), a = Math.min(...n), o = Math.min(...r), s = Math.max(...n) - a, c = Math.max(...r) - o;
  return t.map(([l, d]) => [(l - a) / s, (d - o) / c]);
})(), kn = Array.from({ length: 18 }, (e, t) => {
  const n = -Math.PI / 2 + t * Math.PI / 9, r = t % 2 ? 0.4 : 0.5;
  return [0.5 + r * Math.cos(n), 0.5 + r * Math.sin(n)];
}), Tt = (e, t, n) => e.map(([r, a]) => [r * t, a * n]);
function He(e, t, n, r) {
  const a = $(n, r), o = [
    [e, t, a],
    [e + n, t, a]
  ];
  for (let s = 0; s <= 32; s++) {
    const c = n - n * s / 32;
    o.push([e + c, t + r * 0.88 + r * 0.1 * Math.sin(rt * c / n)]);
  }
  return ce(o);
}
const Rt = (e, t, n, r) => W([e, t, n, r * 0.76], $(n, r) * 0.35), de = (e, t) => [_t(e / 2, t / 2, e / 2, t / 2)], Y = (e, t) => [pe(0, 0, e, t, $(e, t))], wn = (e, t) => W([0, 0, e, t], $(e, t) * 0.35), Pt = (e, t, n) => {
  const r = Math.min(10, e * 0.06);
  return [r, $(e, t) * 0.35, n - r - $(e, t) * 0.35, t - $(e, t) * 0.7];
}, we = (e, t, n = 0.25) => [
  e * n,
  t * n,
  e * (1 - n * 2),
  t * (1 - n * 2)
];
function Dt(e, t) {
  const n = Math.min(t * 0.56, e * 0.3);
  return { x: Math.min(t * 0.2, e * 0.06), y: (t - n) / 2, size: n };
}
const Ne = (e) => ({
  outline: Y,
  text(t, n) {
    const r = Dt(t, n), a = r.x * 2 + r.size;
    return W([a, 0, t - a, n], $(t, n) * 0.35);
  },
  detail(t, n, r, a) {
    const o = Dt(n, r);
    a.glyph(e, o.x, o.y, o.size);
  },
  defaults: { w: 220, h: 90, color: "#ffffff", textAlign: "left" }
});
function Qe(e, t, n = 1) {
  const r = Math.min(t * 0.6, e * 0.22 / n), a = Math.min((t - r) / 2, e * 0.05);
  return { x: a, y: (t - r) / 2, s: r, end: a * 2 + r * n };
}
const Ge = (e) => (t, n) => {
  const r = Qe(t, n, e);
  return W([r.end, 0, t - r.end, n], $(t, n) * 0.35);
};
function U(e, t, n = 1.5, r = ue) {
  e.beginPath(), t.forEach(([a, o], s) => s ? e.lineTo(a, o) : e.moveTo(a, o)), e.lineWidth = n, e.strokeStyle = r, e.stroke();
}
function me(e, t, n, r, a, o) {
  e.beginPath(), e.ellipse(t, n, Math.max(0, r), Math.max(0, a), 0, 0, rt), e.fillStyle = o, e.fill();
}
function ze(e, t, n, r, a, o, s = ue) {
  e.beginPath(), e.ellipse(t, n, Math.max(0, r), Math.max(0, a), 0, 0, rt), e.lineWidth = o, e.strokeStyle = s, e.stroke();
}
function ne(e, t, n, r, a, o) {
  e.beginPath(), e.roundRect(
    t,
    n,
    Math.max(0, r),
    Math.max(0, a),
    Math.max(0, Math.min(o, r / 2, a / 2))
  );
}
function it(e, t, n, r) {
  ze(e, t / 2, n / 2, t / 2 - r / 2, n / 2 - r / 2, r);
}
function st(e, t, n, r) {
  const a = Math.min(t, n), o = Math.max(1.2, a * 0.035);
  me(e, t * 0.37, n * 0.36, a * 0.045, a * 0.045, ue), me(e, t * 0.63, n * 0.36, a * 0.045, a * 0.045, ue);
  const s = n * 0.5, c = r * n * 0.07;
  e.beginPath(), e.moveTo(t * 0.34, s), e.quadraticCurveTo(t * 0.5, s + c * 2, t * 0.66, s), e.lineWidth = o, e.strokeStyle = ue, e.stroke();
}
function Lt(e, t, n) {
  const [r, a, o] = n === "wf-tablet" ? [0.06, 0.08, 0.08] : [0.045, 0.078, 0.067];
  return [e * r, t * a, e * (1 - r * 2), t * (1 - a - o)];
}
const It = (e) => ({
  outline: (t, n) => [
    pe(
      0,
      0,
      t,
      n,
      e === "wf-tablet" ? Math.min(t * 0.06, n * 0.08) : Math.min(t * 0.12, n * 0.07)
    )
  ],
  text: (t, n) => W(Lt(t, n, e), 2),
  detail(t, n, r, a) {
    const [o, s, c, l] = Lt(n, r, e);
    a.trace(), t.rect(o + c, s, -c, l), t.fillStyle = xn, t.fill("evenodd"), e === "wf-tablet" ? me(
      t,
      n / 2,
      s / 2,
      Math.min(n, r) * 0.012,
      Math.min(n, r) * 0.012,
      "#6b737d"
    ) : (ne(t, n * 0.38, s * 0.32, n * 0.24, s * 0.34, s * 0.17), t.fillStyle = "#1f2328", t.fill(), ne(
      t,
      n * 0.35,
      r - (r - s - l) * 0.55,
      n * 0.3,
      Math.max(1, (r - s - l) * 0.1),
      3
    ), t.fillStyle = "#8a929c", t.fill());
  },
  defaults: e === "wf-tablet" ? { w: 720, h: 520, color: "#ffffff" } : { w: 360, h: 720, color: "#ffffff" }
}), ae = { color: "#ffffff", fontSize: 16 };
function qt(e, t, n) {
  const r = Qe(t, n), a = r.s / 2;
  return ze(
    e,
    r.x + a,
    r.y + a,
    a * 0.92,
    a * 0.92,
    Math.max(1, r.s * 0.08)
  ), r;
}
const zn = {
  // Flowchart
  document: {
    outline: (e, t) => [He(0, 0, e, t)],
    text: (e, t) => Rt(0, 0, e, t),
    defaults: { w: 220, h: 130 }
  },
  "multi-document": {
    outline(e, t) {
      const n = Math.min(e, t) * 0.06;
      return [
        He(n * 2, 0, e - n * 2, t - n * 2),
        He(n, n, e - n * 2, t - n * 2),
        He(0, n * 2, e - n * 2, t - n * 2)
      ];
    },
    text(e, t) {
      const n = Math.min(e, t) * 0.06;
      return Rt(0, n * 2, e - n * 2, t - n * 2);
    },
    defaults: { w: 220, h: 140 }
  },
  "predefined-process": {
    outline: Y,
    text(e, t) {
      const n = Math.min(e * 0.1, t * 0.35);
      return W([n, 0, e - n * 2, t], $(e, t) * 0.35);
    },
    detail(e, t, n) {
      const r = Math.min(t * 0.1, n * 0.35);
      U(
        e,
        [
          [r, 0],
          [r, n]
        ],
        1,
        _
      ), U(
        e,
        [
          [t - r, 0],
          [t - r, n]
        ],
        1,
        _
      );
    },
    defaults: { w: 220, h: 110 }
  },
  "manual-input": {
    outline(e, t) {
      const n = $(e, t);
      return [
        ce([
          [0, t * 0.3, n],
          [e, 0, n],
          [e, t, n],
          [0, t, n]
        ])
      ];
    },
    text: (e, t) => W([0, t * 0.3, e, t * 0.7], $(e, t) * 0.5),
    defaults: { w: 220, h: 120 }
  },
  "manual-operation": {
    outline(e, t) {
      const n = $(e, t);
      return [
        ce([
          [0, 0, n],
          [e, 0, n],
          [e * 0.8, t, n],
          [e * 0.2, t, n]
        ])
      ];
    },
    text: (e, t) => W([e * 0.2, 0, e * 0.6, t], $(e, t) * 0.5),
    defaults: { w: 220, h: 110 }
  },
  delay: {
    outline(e, t) {
      const n = $(e, t), r = Math.min(e / 2, t / 2);
      return [
        ce([
          [0, 0, n],
          ...$e(e - r, t / 2, r, t / 2, -Math.PI / 2, Math.PI / 2, 40),
          [0, t, n]
        ])
      ];
    },
    text(e, t) {
      const n = Math.min(e / 2, t / 2);
      return W([0, t * 0.15, e - n * 0.4, t * 0.7], $(e, t) * 0.35);
    },
    defaults: { w: 200, h: 110 }
  },
  display: {
    outline(e, t) {
      const n = Math.min(e * 0.18, t / 2);
      return [
        [
          [0, t / 2],
          [e * 0.18, 0],
          ...$e(e - n, t / 2, n, t / 2, -Math.PI / 2, Math.PI / 2, 40),
          [e * 0.18, t]
        ]
      ];
    },
    text(e, t) {
      const n = Math.min(e * 0.18, t / 2);
      return [e * 0.18, t * 0.1, e * 0.82 - n, t * 0.8];
    },
    defaults: { w: 220, h: 110 }
  },
  "off-page": {
    outline(e, t) {
      const n = $(e, t);
      return [
        ce([
          [0, 0, n],
          [e, 0, n],
          [e, t * 0.62, n / 2],
          [e / 2, t, n / 2],
          [0, t * 0.62, n / 2]
        ])
      ];
    },
    text: (e, t) => W([0, 0, e, t * 0.62], $(e, t) * 0.5),
    defaults: { w: 110, h: 110 }
  },
  or: {
    outline: de,
    text: (e, t) => we(e, t),
    detail(e, t, n) {
      const r = Math.max(1, Math.min(t, n) * 0.02);
      U(
        e,
        [
          [t / 2, 0],
          [t / 2, n]
        ],
        r,
        _
      ), U(
        e,
        [
          [0, n / 2],
          [t, n / 2]
        ],
        r,
        _
      );
    },
    defaults: { w: 80, h: 80 }
  },
  "summing-junction": {
    outline: de,
    text: (e, t) => we(e, t),
    detail(e, t, n) {
      const r = Math.max(1, Math.min(t, n) * 0.02), a = Math.SQRT1_2 / 2;
      U(
        e,
        [
          [t * (0.5 - a), n * (0.5 - a)],
          [t * (0.5 + a), n * (0.5 + a)]
        ],
        r,
        _
      ), U(
        e,
        [
          [t * (0.5 + a), n * (0.5 - a)],
          [t * (0.5 - a), n * (0.5 + a)]
        ],
        r,
        _
      );
    },
    defaults: { w: 80, h: 80 }
  },
  "internal-storage": {
    outline: Y,
    text(e, t) {
      const n = Math.min(e * 0.14, t * 0.3), r = Math.min(t * 0.2, e * 0.3);
      return W([n, r, e - n, t - r], $(e, t) * 0.35);
    },
    detail(e, t, n) {
      const r = Math.min(t * 0.14, n * 0.3), a = Math.min(n * 0.2, t * 0.3);
      U(
        e,
        [
          [r, 0],
          [r, n]
        ],
        1,
        _
      ), U(
        e,
        [
          [0, a],
          [t, a]
        ],
        1,
        _
      );
    },
    defaults: { w: 200, h: 130 }
  },
  merge: {
    outline(e, t) {
      const n = $(e, t);
      return [
        ce([
          [0, 0, n],
          [e, 0, n],
          [e / 2, t, n / 2]
        ])
      ];
    },
    text: (e, t) => W([e * 0.25, 0, e * 0.5, t * 0.45], $(e, t) * 0.35),
    defaults: { w: 140, h: 120 }
  },
  // Architecture and data flow
  cloud: {
    outline: (e, t) => [Tt(Sn, e, t)],
    text: (e, t) => [e * 0.24, t * 0.32, e * 0.52, t * 0.44],
    defaults: { w: 240, h: 150, color: "#ffffff" }
  },
  server: Ne("server"),
  firewall: Ne("brick-wall"),
  "load-balancer": Ne("network"),
  api: Ne("braces"),
  container: Ne("container"),
  queue: {
    outline(e, t) {
      const n = Math.min(e * 0.15, t * 0.25);
      return [
        [
          ...$e(e - n, t / 2, n, t / 2, -Math.PI / 2, Math.PI / 2, 32),
          ...$e(n, t / 2, n, t / 2, Math.PI / 2, Math.PI * 1.5, 32)
        ]
      ];
    },
    text(e, t) {
      const n = Math.min(e * 0.15, t * 0.25);
      return [n * 1.1, t * 0.12, e - n * 3.1, t * 0.76];
    },
    detail(e, t, n) {
      const r = Math.min(t * 0.15, n * 0.25);
      e.beginPath(), e.ellipse(t - r, n / 2, r, n / 2, 0, Math.PI / 2, Math.PI * 1.5), e.lineWidth = 1, e.strokeStyle = _, e.stroke();
    },
    defaults: { w: 240, h: 90, color: "#ffffff" }
  },
  actor: {
    outline(e, t) {
      const n = Math.min(e * 0.3, t * 0.28), r = $(e, t);
      return [
        _t(e / 2, t * 0.2, e * 0.18, t * 0.18, 64),
        ce([
          [e * 0.08, t * 0.44, n],
          [e * 0.92, t * 0.44, n],
          [e * 0.92, t, r],
          [e * 0.08, t, r]
        ])
      ];
    },
    text: (e, t) => [e * 0.2, t * 0.58, e * 0.6, t * 0.36],
    defaults: { w: 130, h: 150, color: "#dce5f7" }
  },
  mobile: {
    outline: (e, t) => [pe(0, 0, e, t, Math.min(e * 0.16, t * 0.1))],
    text: (e, t) => W([e * 0.1, t * 0.12, e * 0.8, t * 0.72], 1),
    detail(e, t, n) {
      ne(e, t * 0.1, n * 0.12, t * 0.8, n * 0.72, 3), e.lineWidth = 1, e.strokeStyle = _, e.stroke(), U(
        e,
        [
          [t * 0.4, n * 0.06],
          [t * 0.6, n * 0.06]
        ],
        Math.max(1, n * 0.012),
        _
      ), ze(
        e,
        t / 2,
        n * 0.92,
        Math.min(t, n) * 0.05,
        Math.min(t, n) * 0.05,
        1,
        _
      );
    },
    defaults: { w: 110, h: 180, color: "#ffffff" }
  },
  laptop: {
    outline(e, t) {
      const n = $(e, t);
      return [
        pe(e * 0.1, 0, e * 0.8, t * 0.8, n),
        ce([
          [e * 0.02, t * 0.8, n / 2],
          [e * 0.98, t * 0.8, n / 2],
          [e, t, n / 2],
          [0, t, n / 2]
        ])
      ];
    },
    text: (e, t) => W([e * 0.15, t * 0.08, e * 0.7, t * 0.64], 1),
    detail(e, t, n) {
      ne(e, t * 0.15, n * 0.08, t * 0.7, n * 0.64, 2), e.lineWidth = 1, e.strokeStyle = _, e.stroke();
    },
    defaults: { w: 220, h: 150, color: "#ffffff" }
  },
  browser: {
    outline: Y,
    text(e, t) {
      const n = Math.min(44, t * 0.18);
      return W([0, n, e, t - n], $(e, t) * 0.35 + 2);
    },
    detail(e, t, n) {
      const r = Math.min(44, n * 0.18), a = Math.min(r * 0.12, t * 0.02);
      e.fillStyle = "#eef1eb", e.fillRect(0, 0, t, r), U(
        e,
        [
          [0, r],
          [t, r]
        ],
        1,
        _
      );
      for (let s = 0; s < 3; s++)
        me(
          e,
          r * 0.45 + s * a * 3.2,
          r / 2,
          a,
          a,
          s ? ke : "#c7a8a2"
        );
      const o = r * 0.45 + a * 10;
      ne(
        e,
        o,
        r * 0.24,
        Math.max(0, t - o - r * 0.45),
        r * 0.52,
        r * 0.26
      ), e.fillStyle = "#ffffff", e.fill(), e.lineWidth = 1, e.strokeStyle = ke, e.stroke();
    },
    defaults: { w: 960, h: 640, color: "#ffffff" }
  },
  "data-store": {
    bare: !0,
    outline: Y,
    text(e, t) {
      const n = Math.min(e * 0.2, t * 0.6);
      return W([n, 0, e - n, t], $(e, t) * 0.35);
    },
    detail(e, t, n) {
      const r = Math.min(t * 0.2, n * 0.6), a = 1.5;
      U(
        e,
        [
          [t, a / 2],
          [a / 2, a / 2],
          [a / 2, n - a / 2],
          [t, n - a / 2]
        ],
        a
      ), U(
        e,
        [
          [r, 0],
          [r, n]
        ],
        a
      );
    },
    defaults: { w: 220, h: 70, color: "#ffffff" }
  },
  // Service blueprint and journey mapping
  touchpoint: {
    outline: de,
    text: (e, t) => we(e, t, 0.22),
    detail(e, t, n) {
      ze(
        e,
        t / 2,
        n / 2,
        t * 0.42,
        n * 0.42,
        Math.max(1, Math.min(t, n) * 0.015),
        _
      );
    },
    defaults: { w: 120, h: 120, color: "#dce5f7" }
  },
  "pain-point": {
    outline: (e, t) => [Tt(kn, e, t)],
    text: (e, t) => [e * 0.27, t * 0.3, e * 0.46, t * 0.4],
    defaults: { w: 150, h: 130, color: "#f4c7c3" }
  },
  "emotion-high": {
    outline: de,
    text: (e, t) => [e * 0.28, t * 0.64, e * 0.44, t * 0.2],
    detail: (e, t, n) => st(e, t, n, 1),
    defaults: { w: 80, h: 80, color: "#d9e9d2" }
  },
  "emotion-neutral": {
    outline: de,
    text: (e, t) => [e * 0.28, t * 0.64, e * 0.44, t * 0.2],
    detail: (e, t, n) => st(e, t, n, 0),
    defaults: { w: 80, h: 80, color: "#f6e7a4" }
  },
  "emotion-low": {
    outline: de,
    text: (e, t) => [e * 0.28, t * 0.64, e * 0.44, t * 0.2],
    detail: (e, t, n) => st(e, t, n, -1),
    defaults: { w: 80, h: 80, color: "#f3d6c8" }
  },
  "lane-header": {
    outline: Y,
    text(e, t) {
      const n = Math.min(e * 0.06, t * 0.3, 12);
      return W([n, 0, e - n, t], $(e, t) * 0.35 + 2);
    },
    detail(e, t, n) {
      e.fillStyle = ve, e.fillRect(0, 0, Math.min(t * 0.06, n * 0.3, 12), n);
    },
    defaults: {
      w: 180,
      h: 120,
      color: "#e6ebdf",
      textAlign: "left",
      bold: !0
    }
  },
  // BPMN
  "start-event": {
    outline: de,
    text: (e, t) => we(e, t),
    detail: (e, t, n) => it(e, t, n, Math.max(1.2, Math.min(t, n) * 0.03)),
    defaults: { w: 60, h: 60, color: "#d9e9d2" }
  },
  "intermediate-event": {
    outline: de,
    text: (e, t) => we(e, t),
    detail(e, t, n) {
      const r = Math.max(1, Math.min(t, n) * 0.025);
      it(e, t, n, r), ze(e, t / 2, n / 2, t * 0.41, n * 0.41, r);
    },
    defaults: { w: 60, h: 60, color: "#f6e7a4" }
  },
  "end-event": {
    outline: de,
    text: (e, t) => we(e, t, 0.28),
    detail: (e, t, n) => it(e, t, n, Math.max(2, Math.min(t, n) * 0.09)),
    defaults: { w: 60, h: 60, color: "#f3d6c8" }
  },
  "bpmn-task": {
    outline: (e, t) => [pe(0, 0, e, t, Math.min(14, e / 4, t / 4))],
    text: (e, t) => W([0, 0, e, t], Math.min(14, e / 4, t / 4) * 0.35),
    defaults: { w: 160, h: 90, color: "#ffffff" }
  },
  subprocess: {
    outline: (e, t) => [pe(0, 0, e, t, Math.min(14, e / 4, t / 4))],
    text(e, t) {
      const n = Math.min(t * 0.18, e * 0.12);
      return W(
        [0, 0, e, t - n - t * 0.08],
        Math.min(14, e / 4, t / 4) * 0.35
      );
    },
    detail(e, t, n) {
      const r = Math.min(n * 0.18, t * 0.12), a = t / 2 - r / 2, o = n - r - n * 0.06;
      e.beginPath(), e.rect(a, o, r, r), e.lineWidth = 1, e.strokeStyle = ue, e.stroke(), U(
        e,
        [
          [a + r * 0.25, o + r / 2],
          [a + r * 0.75, o + r / 2]
        ],
        1
      ), U(
        e,
        [
          [a + r / 2, o + r * 0.25],
          [a + r / 2, o + r * 0.75]
        ],
        1
      );
    },
    defaults: { w: 170, h: 100, color: "#ffffff" }
  },
  "gateway-exclusive": lt((e, t, n, r) => {
    U(
      e,
      [
        [t * 0.4, n * 0.28],
        [t * 0.6, n * 0.48]
      ],
      r
    ), U(
      e,
      [
        [t * 0.6, n * 0.28],
        [t * 0.4, n * 0.48]
      ],
      r
    );
  }),
  "gateway-parallel": lt((e, t, n, r) => {
    U(
      e,
      [
        [t / 2, n * 0.25],
        [t / 2, n * 0.51]
      ],
      r
    ), U(
      e,
      [
        [t * 0.37, n * 0.38],
        [t * 0.63, n * 0.38]
      ],
      r
    );
  }),
  "gateway-inclusive": lt(
    (e, t, n, r) => ze(e, t / 2, n * 0.38, t * 0.12, n * 0.12, r)
  ),
  "data-object": Nt({ w: 90, h: 120, color: "#ffffff" }),
  // UML
  "uml-class": {
    outline: Y,
    text: (e, t) => W([0, 0, e, t * 0.3], $(e, t) * 0.35),
    detail(e, t, n) {
      U(
        e,
        [
          [0, n * 0.3],
          [t, n * 0.3]
        ],
        1,
        _
      ), U(
        e,
        [
          [0, n * 0.65],
          [t, n * 0.65]
        ],
        1,
        _
      );
    },
    defaults: { w: 220, h: 180, color: "#ffffff", bold: !0 }
  },
  "uml-note": Nt({ w: 200, h: 130, color: "#f6e7a4", textAlign: "left" }),
  "uml-package": {
    outline(e, t) {
      const n = $(e, t), r = Math.min(t * 0.2, e * 0.25);
      return [
        ce([
          [0, 0, n],
          [e * 0.4, 0, n / 2],
          [e * 0.4 + r * 0.4, r],
          [e, r, n],
          [e, t, n],
          [0, t, n]
        ])
      ];
    },
    text(e, t) {
      const n = Math.min(t * 0.2, e * 0.25);
      return W([0, n, e, t - n], $(e, t) * 0.35);
    },
    detail(e, t, n) {
      const r = Math.min(n * 0.2, t * 0.25);
      U(
        e,
        [
          [0, r],
          [t * 0.4 + r * 0.4, r]
        ],
        1,
        _
      );
    },
    defaults: { w: 220, h: 150, color: "#ffffff" }
  },
  // Wireframe components
  "wf-button": {
    outline: (e, t) => [pe(0, 0, e, t, Math.min(10, t / 3, e / 4))],
    text: (e, t) => W([0, 0, e, t], Math.min(10, t / 3, e / 4) * 0.35),
    defaults: { w: 160, h: 48, color: "#dce5f7", fontSize: 16 }
  },
  "wf-input": {
    outline: Y,
    text: (e, t) => Pt(e, t, e),
    defaults: { w: 280, h: 48, ...ae, textAlign: "left" }
  },
  "wf-checkbox": {
    bare: !0,
    outline: Y,
    text: Ge(1),
    detail(e, t, n) {
      const r = Qe(t, n);
      ne(e, r.x, r.y, r.s, r.s, r.s * 0.2), e.lineWidth = Math.max(1, r.s * 0.08), e.strokeStyle = ue, e.stroke(), U(
        e,
        [
          [r.x + r.s * 0.24, r.y + r.s * 0.52],
          [r.x + r.s * 0.43, r.y + r.s * 0.7],
          [r.x + r.s * 0.77, r.y + r.s * 0.3]
        ],
        Math.max(1, r.s * 0.1)
      );
    },
    defaults: { w: 200, h: 36, ...ae, textAlign: "left" }
  },
  "wf-radio": {
    bare: !0,
    outline: Y,
    text: Ge(1),
    // Unselected: a group of radio buttons has one choice at most, and
    // forms start with none, so a group of these never shows two chosen.
    detail: qt,
    defaults: { w: 200, h: 36, ...ae, textAlign: "left" }
  },
  // The one chosen option in a group.
  "wf-radio-selected": {
    bare: !0,
    outline: Y,
    text: Ge(1),
    detail(e, t, n) {
      const r = qt(e, t, n), a = r.s / 2;
      me(e, r.x + a, r.y + a, a * 0.45, a * 0.45, ue);
    },
    defaults: { w: 200, h: 36, ...ae, textAlign: "left" }
  },
  "wf-toggle": {
    bare: !0,
    outline: Y,
    text: Ge(1.8),
    detail(e, t, n) {
      const r = Qe(t, n, 1.8);
      ne(e, r.x, r.y, r.s * 1.8, r.s, r.s / 2), e.fillStyle = ve, e.fill(), me(
        e,
        r.x + r.s * 1.3,
        r.y + r.s / 2,
        r.s * 0.38,
        r.s * 0.38,
        "#ffffff"
      );
    },
    defaults: { w: 200, h: 36, ...ae, textAlign: "left" }
  },
  "wf-dropdown": {
    outline: Y,
    text(e, t) {
      return Pt(e, t, e - Math.min(t * 0.3, e * 0.1) * 3);
    },
    detail(e, t, n) {
      const r = Math.min(n * 0.3, t * 0.1), a = t - r * 1.6, o = n / 2;
      U(
        e,
        [
          [a - r / 2, o - r / 4],
          [a, o + r / 4],
          [a + r / 2, o - r / 4]
        ],
        Math.max(1, r * 0.14)
      );
    },
    defaults: { w: 280, h: 48, ...ae, textAlign: "left" }
  },
  "wf-search": {
    outline: (e, t) => [pe(0, 0, e, t, Math.min(e, t) / 2)],
    // Wide bars put the magnifier before the label; the magnifier and gaps
    // scale with both sides, so the label keeps its room as the bar
    // narrows. Narrower bars stack the label below the magnifier.
    text(e, t) {
      const { g: n, x: r, gap: a, right: o } = Et(e, t);
      if (e < t * 1.5) {
        const c = Math.max(t * 0.25, t * 0.06 + n + t * 0.04);
        return [e * 0.25, c, e * 0.5, Math.max(0, t * 0.75 - c)];
      }
      const s = r + n + a;
      return [s, t * 0.2, Math.max(0, e - s - o), t * 0.6];
    },
    detail(e, t, n, r) {
      const { g: a, x: o } = Et(t, n);
      r.glyph(
        "search",
        t < n * 1.5 ? (t - a) / 2 : o,
        t < n * 1.5 ? n * 0.06 : (n - a) / 2,
        a
      );
    },
    defaults: { w: 280, h: 44, ...ae, textAlign: "left" }
  },
  "wf-navbar": {
    outline: Y,
    text(e, t) {
      const n = Math.min(t * 0.5, e * 0.12), r = Math.min(t * 0.3, e * 0.05), a = r * 2 + n;
      return W([a, 0, e - a * 2, t], $(e, t) * 0.35);
    },
    detail(e, t, n) {
      const r = Math.min(n * 0.5, t * 0.12), a = Math.min(n * 0.3, t * 0.05);
      me(e, a + r / 2, n / 2, r / 2, r / 2, ke);
      const o = t - a - r, s = Math.max(1, r * 0.1);
      for (let c = 0; c < 3; c++)
        U(
          e,
          [
            [o + r * 0.1, n / 2 + (c - 1) * r * 0.28],
            [o + r * 0.9, n / 2 + (c - 1) * r * 0.28]
          ],
          s
        );
    },
    defaults: { w: 320, h: 56, color: "#e6ebdf", fontSize: 16, bold: !0 }
  },
  "wf-tabbar": {
    outline: Y,
    text: (e, t) => W([0, t * 0.5, e, t * 0.5], $(e, t) * 0.35),
    detail(e, t, n) {
      const r = Math.min(n * 0.26, t * 0.1);
      for (let a = 0; a < 4; a++)
        ne(
          e,
          t * (a + 0.5) / 4 - r / 2,
          n * 0.28 - r / 2,
          r,
          r,
          r * 0.25
        ), a ? (e.lineWidth = Math.max(1, r * 0.08), e.strokeStyle = ue, e.stroke()) : (e.fillStyle = ve, e.fill());
    },
    defaults: { w: 320, h: 64, color: "#e6ebdf", fontSize: 12 }
  },
  "wf-card": {
    outline: Y,
    text: (e, t) => W([0, t * 0.5, e, t * 0.5], $(e, t) * 0.35 + 2),
    detail(e, t, n, r) {
      e.fillStyle = "#e6ebdf", e.fillRect(0, 0, t, n * 0.46), U(
        e,
        [
          [0, n * 0.46],
          [t, n * 0.46]
        ],
        1,
        _
      );
      const a = Math.min(n * 0.2, t * 0.3);
      r.glyph("image", t / 2 - a / 2, n * 0.23 - a / 2, a, _);
    },
    defaults: { w: 280, h: 240, ...ae, textAlign: "left" }
  },
  "wf-image": {
    outline: Y,
    text: (e, t) => W([0, t * 0.7, e, t * 0.3], $(e, t) * 0.35),
    detail(e, t, n, r) {
      const a = Math.min(n * 0.4, t * 0.4);
      r.glyph("image", t / 2 - a / 2, n * 0.4 - a / 2, a, "#7d857a");
    },
    defaults: { w: 280, h: 160, color: "#e6ebdf" }
  },
  "wf-avatar": {
    outline: de,
    text: (e, t) => we(e, t, 0.22),
    detail(e, t, n, r) {
      r.item.text || (me(e, t / 2, n * 0.4, t * 0.18, n * 0.18, "#aab3a6"), e.beginPath(), e.ellipse(t / 2, n * 0.9, t * 0.28, n * 0.26, 0, Math.PI, Math.PI * 2), e.closePath(), e.fillStyle = "#aab3a6", e.fill());
    },
    defaults: { w: 64, h: 64, color: "#e6ebdf" }
  },
  "wf-modal": {
    outline: (e, t) => [pe(0, 0, e, t, Math.min(12, e / 4, t / 4))],
    text(e, t) {
      const n = Ot(e, t);
      return W(
        [0, n.header, e, t - n.header - n.button - n.pad * 2],
        n.pad * 0.5
      );
    },
    detail(e, t, n) {
      const r = Ot(t, n);
      U(
        e,
        [
          [0, r.header],
          [t, r.header]
        ],
        1,
        _
      );
      const a = r.header / 2, o = t - r.header / 2, s = r.header * 0.14;
      U(
        e,
        [
          [o - s, a - s],
          [o + s, a + s]
        ],
        1.5
      ), U(
        e,
        [
          [o + s, a - s],
          [o - s, a + s]
        ],
        1.5
      ), U(
        e,
        [
          [r.pad, a],
          [Math.max(r.pad, t * 0.45), a]
        ],
        Math.max(2, r.header * 0.14),
        ke
      );
      for (let c = 0; c < 2; c++) {
        const l = t - r.pad * (c + 1) - r.buttonW * (c + 1);
        ne(
          e,
          l,
          n - r.pad - r.button,
          r.buttonW,
          r.button,
          r.button * 0.25
        ), c ? (e.lineWidth = 1, e.strokeStyle = ue, e.stroke()) : (e.fillStyle = ve, e.fill());
      }
    },
    defaults: { w: 360, h: 240, ...ae }
  },
  "wf-phone": It("wf-phone"),
  "wf-tablet": It("wf-tablet"),
  "wf-slider": {
    bare: !0,
    outline: Y,
    text: (e, t) => W([e * 0.72, 0, e * 0.28, t], $(e, t) * 0.35),
    detail(e, t, n) {
      const r = Math.min(n * 0.3, t * 0.06), a = r + Math.min(n * 0.1, t * 0.02), o = t * 0.68, s = a + (o - a) * 0.45, c = Math.max(2, n * 0.14);
      ne(e, a, n / 2 - c / 2, o - a, c, c / 2), e.fillStyle = ke, e.fill(), ne(e, a, n / 2 - c / 2, s - a, c, c / 2), e.fillStyle = ve, e.fill(), me(e, s, n / 2, r, r, "#ffffff"), ze(e, s, n / 2, r, r, Math.max(1, r * 0.15), ve);
    },
    defaults: { w: 240, h: 36, ...ae }
  },
  "wf-progress": {
    bare: !0,
    outline: Y,
    text: (e, t) => W([e * 0.76, 0, e * 0.24, t], $(e, t) * 0.35),
    detail(e, t, n) {
      const r = n * 0.4;
      ne(e, 1, n * 0.3, t * 0.72, r, r / 2), e.fillStyle = ke, e.fill(), ne(e, 1, n * 0.3, t * 0.72 * 0.6, r, r / 2), e.fillStyle = ve, e.fill();
    },
    defaults: { w: 240, h: 28, ...ae, fontSize: 14 }
  },
  "wf-pagination": {
    bare: !0,
    outline: Y,
    text(e, t) {
      const n = $t(e, t), r = n.end + n.gap;
      return W([r, 0, e - r, t], $(e, t) * 0.35);
    },
    detail(e, t, n) {
      const r = $t(t, n);
      ["‹", "1", "2", "3", "›"].forEach((a, o) => {
        const s = r.x + o * (r.s + r.gap);
        ne(e, s, (n - r.s) / 2, r.s, r.s, r.s * 0.2), o === 1 ? (e.fillStyle = ve, e.fill()) : (e.lineWidth = 1, e.strokeStyle = _, e.stroke()), e.fillStyle = o === 1 ? "#ffffff" : ue, e.font = `500 ${Math.max(1, r.s * 0.5)}px "DM Sans", system-ui, sans-serif`, e.textAlign = "center", e.textBaseline = "middle", e.fillText(a, s + r.s / 2, n / 2 + r.s * 0.03);
      }), e.textAlign = "left", e.textBaseline = "top";
    },
    defaults: { w: 260, h: 40, ...ae, fontSize: 14, textAlign: "left" }
  },
  "wf-paragraph": {
    bare: !0,
    outline: Y,
    text: wn,
    detail(e, t, n, r) {
      if (r.item.text) return;
      const a = Math.min(24, Math.max(4, n / 3)), o = Math.max(1, Math.floor(n / a)), s = [1, 0.94, 0.98, 0.62];
      for (let c = 0; c < o; c++) {
        const l = (c === o - 1 ? 0.62 : s[c % 3]) * (t - 4);
        ne(
          e,
          2,
          c * a + a * 0.3,
          l,
          a * 0.42,
          a * 0.21
        ), e.fillStyle = ke, e.fill();
      }
    },
    defaults: { w: 280, h: 80, ...ae, textAlign: "left" }
  }
};
for (const e of [
  "or",
  "summing-junction",
  "off-page",
  "merge",
  "touchpoint",
  "pain-point",
  "emotion-high",
  "emotion-neutral",
  "emotion-low",
  "start-event",
  "intermediate-event",
  "end-event",
  "gateway-exclusive",
  "gateway-parallel",
  "gateway-inclusive",
  "data-object",
  "actor",
  "mobile",
  "wf-avatar"
])
  Object.assign(zn[e].defaults, {
    fontSize: 14,
    autoFontSize: !0
  });
function lt(e) {
  return {
    outline: (t, n) => [
      [
        [t / 2, 0],
        [t, n / 2],
        [t / 2, n],
        [0, n / 2]
      ]
    ],
    // Below the marker and inside the diamond, room for a short label
    // such as Yes or No at the default size.
    text: (t, n) => [t * 0.25, n * 0.53, t * 0.5, n * 0.22],
    detail: (t, n, r) => e(t, n, r, Math.max(1.5, Math.min(n, r) * 0.04)),
    defaults: { w: 70, h: 70, color: "#f6e7a4" }
  };
}
function Nt(e) {
  const t = (n, r) => Math.min(n * 0.3, r * 0.3);
  return {
    outline(n, r) {
      const a = $(n, r), o = t(n, r);
      return [
        ce([
          [0, 0, a],
          [n - o, 0],
          [n, o],
          [n, r, a],
          [0, r, a]
        ])
      ];
    },
    text(n, r) {
      const a = t(n, r);
      return W([0, a, n, r - a], $(n, r) * 0.35 + 1);
    },
    detail(n, r, a) {
      const o = t(r, a);
      U(
        n,
        [
          [r - o, 0],
          [r - o, o],
          [r, o]
        ],
        1,
        _
      );
    },
    defaults: e
  };
}
function Ot(e, t) {
  const n = Math.min(t * 0.22, 56), r = Math.min(t * 0.05, e * 0.04, 16), a = Math.min(t * 0.16, 40), o = Math.min(e * 0.22, 100);
  return { header: n, pad: r, button: a, buttonW: o };
}
function $t(e, t) {
  const n = Math.min(t * 0.8, e * 0.12), r = n * 0.2, a = Math.min((t - n) / 2, e * 0.02);
  return { s: n, gap: r, x: a, end: a + n * 5 + r * 4 };
}
const _e = [
  { key: "rectangle", name: "Rectangle", hint: "Process" },
  { key: "ellipse", name: "Ellipse", hint: "Start or end" },
  { key: "diamond", name: "Diamond", hint: "Decision" },
  { key: "parallelogram", name: "Parallelogram", hint: "Input or output" },
  { key: "cylinder", name: "Cylinder", hint: "Database" },
  { key: "terminator", name: "Terminator", hint: "Start or end" },
  { key: "hexagon", name: "Hexagon", hint: "Preparation" },
  { key: "triangle", name: "Triangle", hint: "Basic shape" },
  { key: "star", name: "Star", hint: "Basic shape" },
  // Specialist families. Each key is a rectangle object with a silhouette.
  { key: "document", name: "Document", hint: "Flowchart" },
  { key: "multi-document", name: "Multiple documents", hint: "Flowchart" },
  { key: "predefined-process", name: "Predefined process", hint: "Flowchart" },
  { key: "manual-input", name: "Manual input", hint: "Flowchart" },
  { key: "manual-operation", name: "Manual operation", hint: "Flowchart" },
  { key: "delay", name: "Delay", hint: "Flowchart" },
  { key: "display", name: "Display", hint: "Flowchart" },
  { key: "off-page", name: "Off-page connector", hint: "Flowchart" },
  { key: "or", name: "Or", hint: "Flowchart" },
  { key: "summing-junction", name: "Summing junction", hint: "Flowchart" },
  { key: "internal-storage", name: "Internal storage", hint: "Flowchart" },
  { key: "merge", name: "Merge", hint: "Flowchart" },
  { key: "cloud", name: "Cloud", hint: "Architecture" },
  { key: "server", name: "Server", hint: "Architecture" },
  { key: "queue", name: "Queue", hint: "Architecture" },
  { key: "actor", name: "User or actor", hint: "Architecture" },
  { key: "mobile", name: "Mobile device", hint: "Architecture" },
  { key: "laptop", name: "Laptop", hint: "Architecture" },
  { key: "browser", name: "Browser window", hint: "Architecture" },
  { key: "firewall", name: "Firewall", hint: "Architecture" },
  { key: "load-balancer", name: "Load balancer", hint: "Architecture" },
  { key: "api", name: "API", hint: "Architecture" },
  { key: "container", name: "Container", hint: "Architecture" },
  { key: "data-store", name: "Data store", hint: "Data flow" },
  { key: "touchpoint", name: "Touchpoint", hint: "Service blueprint" },
  { key: "pain-point", name: "Pain point", hint: "Journey map" },
  { key: "emotion-high", name: "Positive emotion", hint: "Journey map" },
  { key: "emotion-neutral", name: "Neutral emotion", hint: "Journey map" },
  { key: "emotion-low", name: "Negative emotion", hint: "Journey map" },
  { key: "lane-header", name: "Lane header", hint: "Service blueprint" },
  { key: "start-event", name: "Start event", hint: "BPMN" },
  { key: "intermediate-event", name: "Intermediate event", hint: "BPMN" },
  { key: "end-event", name: "End event", hint: "BPMN" },
  { key: "bpmn-task", name: "Task", hint: "BPMN" },
  { key: "subprocess", name: "Subprocess", hint: "BPMN" },
  { key: "gateway-exclusive", name: "Exclusive gateway", hint: "BPMN" },
  { key: "gateway-parallel", name: "Parallel gateway", hint: "BPMN" },
  { key: "gateway-inclusive", name: "Inclusive gateway", hint: "BPMN" },
  { key: "data-object", name: "Data object", hint: "BPMN" },
  { key: "uml-class", name: "Class", hint: "UML" },
  { key: "uml-note", name: "Note", hint: "UML" },
  { key: "uml-package", name: "Package", hint: "UML" },
  { key: "wf-button", name: "Button", hint: "Wireframe" },
  { key: "wf-input", name: "Text input", hint: "Wireframe" },
  { key: "wf-checkbox", name: "Checkbox", hint: "Wireframe" },
  { key: "wf-radio", name: "Radio button", hint: "Wireframe" },
  {
    key: "wf-radio-selected",
    name: "Selected radio button",
    hint: "Wireframe"
  },
  { key: "wf-toggle", name: "Toggle", hint: "Wireframe" },
  { key: "wf-dropdown", name: "Dropdown", hint: "Wireframe" },
  { key: "wf-search", name: "Search bar", hint: "Wireframe" },
  { key: "wf-navbar", name: "Navigation bar", hint: "Wireframe" },
  { key: "wf-tabbar", name: "Tab bar", hint: "Wireframe" },
  { key: "wf-card", name: "Card", hint: "Wireframe" },
  { key: "wf-image", name: "Image placeholder", hint: "Wireframe" },
  { key: "wf-avatar", name: "Avatar", hint: "Wireframe" },
  { key: "wf-modal", name: "Modal dialog", hint: "Wireframe" },
  { key: "wf-phone", name: "Mobile phone frame", hint: "Wireframe" },
  { key: "wf-tablet", name: "Tablet frame", hint: "Wireframe" },
  { key: "wf-slider", name: "Slider", hint: "Wireframe" },
  { key: "wf-progress", name: "Progress bar", hint: "Wireframe" },
  { key: "wf-pagination", name: "Pagination", hint: "Wireframe" },
  { key: "wf-paragraph", name: "Text placeholder", hint: "Wireframe" }
];
new Set(_e.slice(2).map((e) => e.key));
_e.slice(0, 9).map((e) => ({ key: e.key })), [
  "cloud",
  "server",
  "cylinder",
  "queue",
  "actor",
  "mobile",
  "laptop",
  "browser",
  "firewall",
  "load-balancer",
  "api",
  "container",
  "data-store"
].map((e) => ({
  key: e,
  ...e === "cylinder" ? { name: "Database" } : {}
})), [
  "touchpoint",
  "pain-point",
  "emotion-high",
  "emotion-neutral",
  "emotion-low",
  "lane-header",
  "actor"
].map((e) => ({ key: e })), [
  "start-event",
  "intermediate-event",
  "end-event",
  "bpmn-task",
  "subprocess",
  "gateway-exclusive",
  "gateway-parallel",
  "gateway-inclusive",
  "data-object"
].map((e) => ({ key: e })), [
  ..._e.filter((e) => e.key.startsWith("wf-")).slice(0, 14),
  { key: "browser" },
  ..._e.filter((e) => e.key.startsWith("wf-")).slice(14)
].map((e) => ({ key: e.key }));
Array.from({ length: 10 }, (e, t) => {
  const n = -Math.PI / 2 + t * Math.PI / 5, r = t % 2 ? 0.22 : 0.5;
  return [0.5 + r * Math.cos(n), 0.5 + r * Math.sin(n)];
});
let Me = "en";
try {
  Me = localStorage.getItem("whiteboard-language") === "fr" ? "fr" : "en";
} catch {
}
function Mn(e) {
  Me = "fr";
  try {
    localStorage.setItem("whiteboard-language", Me);
  } catch {
  }
  document.documentElement.lang = Me;
}
const Je = {
  __proto__: null,
  "Move selection": "Déplacer la sélection",
  "In frame": "Dans le cadre",
  Group: "Groupe",
  Contains: "Contient",
  "visible object": "objet visible",
  "visible objects": "objets visibles",
  "Mind map parent": "Parent de la carte mentale",
  "Content language": "Langue du contenu",
  "Whole comment": "Commentaire entier",
  "Selected text": "Texte sélectionné",
  "The comment text changed. Reopen Content language to select the passage again.": "Le texte du commentaire a changé. Rouvrez Langue du contenu pour sélectionner à nouveau le passage.",
  "Apply to": "Appliquer à",
  "Language tag": "Code de langue",
  "Selected text or next typed text": "Texte sélectionné ou prochain texte saisi",
  "Whole object": "Objet entier",
  "Whole field": "Champ entier",
  "Select complete characters to set their language.": "Sélectionnez des caractères entiers pour définir leur langue.",
  "Apply language": "Appliquer la langue",
  "Enter a language tag, such as en, fr-CA, or es. Leave empty to inherit the surrounding language.": "Saisissez un code de langue, comme en, fr-CA ou es. Laissez vide pour hériter de la langue environnante.",
  "Enter a valid language tag, such as en or fr-CA.": "Saisissez un code de langue valide, comme en ou fr-CA.",
  "Select multiple objects": "Sélectionner plusieurs objets",
  "Turn on Select multiple objects, then click objects to add or remove them. Choose Done to use the selection.": "Activez Sélectionner plusieurs objets, puis cliquez sur les objets pour les ajouter ou les retirer. Choisissez Terminé pour utiliser la sélection.",
  "Start horizontal position": "Position horizontale du départ",
  "Start vertical position": "Position verticale du départ",
  "End horizontal position": "Position horizontale de l’arrivée",
  "End vertical position": "Position verticale de l’arrivée",
  "Choose an object for each end, or select Free endpoint and enter its position in board pixels.": "Choisissez un objet pour chaque extrémité, ou sélectionnez Extrémité libre et saisissez sa position en pixels du tableau.",
  "The endpoints exceed the board limits. Choose closer positions.": "Les extrémités dépassent les limites du tableau. Choisissez des positions plus rapprochées.",
  "Extend selection": "Étendre la sélection",
  "Turn on Extend selection, then click another cell to select a range.": "Activez Étendre la sélection, puis cliquez sur une autre cellule pour sélectionner une plage.",
  "Set export region": "Définir la zone d’exportation",
  "Use region": "Utiliser la zone",
  "Enter the top-left position and size of the export region in board pixels.": "Saisissez la position du coin supérieur gauche et la taille de la zone d’exportation en pixels du tableau.",
  "Move pin": "Déplacer le repère",
  "Horizontal position": "Position horizontale",
  "Vertical position": "Position verticale",
  "Set the pin position in board pixels.": "Définissez la position du repère en pixels du tableau.",
  "This pin moved. Close and reopen Move pin to use its current position.": "Ce repère a été déplacé. Fermez et rouvrez Déplacer le repère pour utiliser sa position actuelle.",
  Position: "Position",
  "Horizontal distance": "Distance horizontale",
  "Vertical distance": "Distance verticale",
  "Apply move": "Appliquer le déplacement",
  "Select objects that can be moved.": "Sélectionnez des objets qui peuvent être déplacés.",
  "Move exceeds the board limits. Enter a smaller distance.": "Le déplacement dépasse les limites du tableau. Saisissez une distance plus petite.",
  "Move the selection and its contents by a distance in board pixels. Positive values move right or down; negative values move left or up.": "Déplacez la sélection et son contenu d’une distance en pixels du tableau. Les valeurs positives déplacent vers la droite ou le bas ; les valeurs négatives vers la gauche ou le haut.",
  "Enable letter and symbol shortcuts": "Activer les raccourcis avec des lettres et des symboles",
  "Turn off shortcuts such as N, Shift + N, and ? to avoid accidental actions. Ctrl/Cmd and Alt/Option shortcuts remain available. This preference is saved on this device and shared with other open tabs.": "Désactivez les raccourcis tels que N, Maj + N et ? pour éviter les actions accidentelles. Les raccourcis Ctrl/Cmd et Alt/Option restent disponibles. Ce réglage est enregistré sur cet appareil et partagé avec les autres onglets ouverts.",
  "Image proportions are too extreme to replace.": "Les proportions de l’image sont trop extrêmes pour la remplacer.",
  "Replace image": "Remplacer l’image",
  "Replace from board": "Remplacer depuis le tableau",
  "Upload from device": "Importer depuis l’appareil",
  "Image URL": "URL de l’image",
  "Load image": "Charger l’image",
  "Images on this board": "Images de ce tableau",
  "Find an image": "Rechercher une image",
  "Previous images": "Images précédentes",
  "Next images": "Images suivantes",
  "Replacement preview": "Aperçu du remplacement",
  "Choose a replacement image.": "Choisissez une image de remplacement.",
  "Loading image…": "Chargement de l’image…",
  "Ready to replace. Undo restores the previous image.": "Prête à remplacer. Annulez pour restaurer l’image précédente.",
  "This image is already in place.": "Cette image est déjà en place.",
  "No other images on this board.": "Aucune autre image sur ce tableau.",
  "Image replaced. Undo restores it.": "Image remplacée. Annulez pour la restaurer.",
  "Replacement closed because the image changed or is no longer editable.": "Le remplacement a été fermé car l’image a changé ou ne peut plus être modifiée.",
  "Keep the image’s size, position, rotation, mask, links, and comments. The replacement fills its current area; use Crop image to adjust it.": "Conservez la taille, la position, la rotation, le masque, les liens et les commentaires. L’image de remplacement remplit la zone actuelle ; utilisez Recadrer l’image pour l’ajuster.",
  "Enter an HTTP or HTTPS image URL.": "Saisissez une URL d’image HTTP ou HTTPS.",
  "This image could not be loaded. Download it and choose Upload from device.": "Impossible de charger cette image. Téléchargez-la et choisissez Importer depuis l’appareil.",
  "Loading timed out. Try again or upload from device.": "Le chargement a expiré. Réessayez ou importez depuis l’appareil.",
  "Clear content": "Effacer le contenu",
  "Clear content (Ctrl/Cmd Backspace)": "Effacer le contenu (Ctrl/Cmd Retour arrière)",
  "Clear content of sticky notes and shapes": "Effacer le contenu des notes et des formes",
  "Select sticky notes or shapes to clear.": "Sélectionnez des notes ou des formes à vider.",
  "The selected content is already empty.": "Le contenu sélectionné est déjà vide.",
  "Content cleared. Undo restores it.": "Contenu effacé. Annulez pour le restaurer.",
  "Select object in group": "Sélectionner un objet du groupe",
  "Select whole group": "Sélectionner tout le groupe",
  "Select an object inside a group first.": "Sélectionnez d’abord un objet dans un groupe.",
  "Inside group · Double-click to edit · Escape selects the group": "Dans le groupe · Double-cliquez pour modifier · Échap sélectionne le groupe",
  "Double-click an object to select it within this group.": "Double-cliquez sur un objet pour le sélectionner dans ce groupe.",
  "Lock group": "Verrouiller le groupe",
  "Select a group member or edit the focused object": "Sélectionner un membre du groupe ou modifier l’objet actif",
  "Select a group member / whole group": "Sélectionner un membre / tout le groupe",
  "Selection settings": "Réglages de sélection",
  "Precise selection": "Sélection précise",
  "Precise selection: enclose at least 90% of each object.": "Sélection précise : encadrez au moins 90 % de chaque objet.",
  "Select objects when at least 90% is inside the selection box. Turn off to select touched objects. Tables and mind map nodes always require 90% coverage.": "Sélectionnez les objets dont au moins 90 % est dans le cadre de sélection. Désactivez pour sélectionner les objets touchés. Les tableaux et nœuds de carte mentale nécessitent toujours 90 % de couverture.",
  "Hold the mouse or your finger still for a moment, then drag to use precise selection over background objects. Hold Shift while dragging to add to your selection. Escape cancels.": "Maintenez la souris ou le doigt immobile un instant, puis faites glisser pour sélectionner précisément par-dessus les objets d’arrière-plan. Maintenez Maj pour ajouter à la sélection. Échap annule.",
  "Filter selection": "Filtrer la sélection",
  "Choose the object type to keep selected.": "Choisissez le type d’objet à conserver dans la sélection.",
  "Groups stay together. Frames keep their contents; mind map nodes keep their branches.": "Les groupes restent entiers. Les cadres conservent leur contenu et les nœuds de carte mentale leurs branches.",
  "The selection changed. Choose a type again.": "La sélection a changé. Choisissez à nouveau un type.",
  "This link is no longer on the board.": "Ce lien n’est plus sur le tableau.",
  "These objects are no longer on the board.": "Ces objets ne sont plus sur le tableau.",
  "Connection lines": "Lignes de connexion",
  Drawings: "Dessins",
  Images: "Images",
  Tables: "Tableaux de données",
  Links: "Liens",
  Attachments: "Pièces jointes",
  "Mind map nodes": "Nœuds de carte mentale",
  Groups: "Groupes",
  Frames: "Cadres",
  "Object dimensions": "Dimensions des objets",
  "Show dimensions and matching-size guides": "Afficher les dimensions et les repères de taille identique",
  "See the selection’s width and height in board pixels. Resize near another object’s width or height to match its size.": "Affichez la largeur et la hauteur de la sélection en pixels du canevas. Redimensionnez près de la largeur ou de la hauteur d’un autre objet pour obtenir la même taille.",
  "Matching sizes uses Snap to objects. Hold Alt/Option to bypass snapping. Exact numeric dimensions stay precise.": "La correspondance de taille utilise l’alignement sur les objets. Maintenez Alt/Option pour ignorer l’alignement. Les dimensions numériques exactes restent précises.",
  "Grid and snapping": "Grille et alignement",
  "Canvas grid": "Grille du canevas",
  "No grid": "Sans grille",
  "Line grid": "Grille en lignes",
  "Dot grid": "Grille en points",
  "Snap to grid": "Aligner sur la grille",
  "New objects, moves, and resize edges snap to the visible grid. Object alignment guides take priority.": "Les nouveaux objets, les déplacements et les bords redimensionnés s’alignent sur la grille visible. Les repères d’alignement des objets sont prioritaires.",
  "Hold Ctrl/Cmd or Alt/Option during a gesture to bypass grid snapping. Keyboard nudges and exact dimensions stay precise.": "Maintenez Ctrl/Cmd ou Alt/Option pendant un geste pour ignorer la grille. Les déplacements au clavier et les dimensions exactes restent précis.",
  Follow: "Suivre",
  Following: "Vous suivez",
  "Following you": "Vous suit",
  "one|{count} following you": "{count} vous suit",
  "{count} following you": "{count} vous suivent",
  "Stop following": "Ne plus suivre",
  "Bring to me": "Amener vers moi",
  "Bring everyone to me": "Amener tout le monde vers moi",
  "Live navigation": "Navigation en direct",
  Live: "En direct",
  "Waiting for live view": "En attente de la vue en direct",
  "Board access": "Accès au tableau",
  "Find a participant": "Trouver un participant",
  "Show collaborator cursors": "Afficher les curseurs des collaborateurs",
  "No other participants are on this board.": "Aucun autre participant sur ce tableau.",
  "{count} participants": "{count} participants",
  "{count} participant": "{count} participant",
  "No participants match your search.": "Aucun participant ne correspond à votre recherche.",
  "Invited you to follow": "Vous invite à suivre sa vue",
  Dismiss: "Fermer",
  "Follow a participant’s view. Pan, zoom, click the board, or press Escape to stop.": "Suivez la vue d’un participant. Déplacez la vue, zoomez, cliquez sur le tableau ou appuyez sur Échap pour arrêter.",
  "Cannot follow a circular chain.": "Impossible de suivre une chaîne circulaire.",
  "Following stopped because the live view is unavailable.": "Le suivi est arrêté car la vue en direct est indisponible.",
  "Following stopped to avoid a loop.": "Le suivi est arrêté pour éviter une boucle.",
  "Asked participants to follow you.": "Les participants ont été invités à vous suivre.",
  "A live connection is needed to bring participants to your view.": "Une connexion en direct est nécessaire pour amener les participants vers votre vue.",
  "Could not send the follow request. Try again.": "Impossible d’envoyer la demande de suivi. Réessayez.",
  "Workshop timer": "Minuteur d’atelier",
  Timer: "Minuteur",
  Minimize: "Réduire",
  "Time remaining": "Temps restant",
  Minutes: "Minutes",
  Seconds: "Secondes",
  min: "min",
  "Start timer": "Démarrer",
  "Pause timer": "Mettre en pause",
  "Resume timer": "Reprendre",
  "Reset timer": "Réinitialiser",
  "Play a chime on this device": "Jouer un son sur cet appareil",
  "Invalid workshop timer.": "Minuteur d’atelier non valide.",
  "The timer can run for up to 24 hours.": "Le minuteur peut durer jusqu’à 24 heures.",
  "Set a timer from 1 second to 24 hours.": "Réglez une durée de 1 seconde à 24 heures.",
  "Time’s up.": "Le temps est écoulé.",
  Ready: "Prêt",
  "Counting down": "Décompte en cours",
  Paused: "En pause",
  "The timer is shared with everyone on this board. Editors can control it.": "Le minuteur est partagé avec tout le monde sur ce tableau. Les éditeurs peuvent le contrôler.",
  "The timer keeps counting when minimized or when you leave this board.": "Le décompte continue quand le minuteur est réduit ou que vous quittez ce tableau.",
  "selected note": "note sélectionnée",
  tag: "étiquette",
  Tags: "Étiquettes",
  tags: "étiquettes",
  Tag: "Étiquette",
  "All tags": "Toutes les étiquettes",
  "Tag name": "Nom de l’étiquette",
  "Tag color": "Couleur de l’étiquette",
  "Current color": "Couleur actuelle",
  "Create tag": "Créer une étiquette",
  "Edit tag": "Modifier l’étiquette",
  "Save tag": "Enregistrer l’étiquette",
  "Search tags": "Rechercher des étiquettes",
  "No matching tags.": "Aucune étiquette correspondante.",
  "Find tagged notes": "Trouver les notes étiquetées",
  "Delete tag from board": "Supprimer l’étiquette du tableau",
  "selected notes": "notes sélectionnées",
  "This selection is protected.": "Cette sélection est protégée.",
  "This tag changed. Reopen its settings.": "Cette étiquette a changé. Rouvrez ses paramètres.",
  "A sticky note can have up to 8 tags.": "Une note peut porter jusqu’à 8 étiquettes.",
  "A board can contain up to 1,000 tags.": "Un tableau peut contenir jusqu’à 1 000 étiquettes.",
  "Invalid board tag.": "Étiquette de tableau non valide.",
  "A tag with this name already exists.": "Une étiquette portant ce nom existe déjà.",
  "This tag is also used on content hidden from you.": "Cette étiquette sert aussi sur du contenu qui vous est masqué.",
  "Unlock tagged objects before changing this tag.": "Déverrouillez les objets étiquetés avant de modifier cette étiquette.",
  "Tags apply to selected sticky notes. Renaming, recoloring, or deleting a tag affects the whole board. Up to 8 tags per note.": "Les étiquettes s’appliquent aux notes sélectionnées. Leur nom, couleur et suppression concernent tout le tableau. Jusqu’à 8 étiquettes par note.",
  "Column width": "Largeur des colonnes",
  "Row height": "Hauteur des lignes",
  "Fit columns to text": "Ajuster les colonnes au texte",
  "Fit rows to text": "Ajuster les lignes au texte",
  "Equal column widths": "Uniformiser les largeurs",
  "Equal row heights": "Uniformiser les hauteurs",
  "Resize column": "Redimensionner la colonne",
  "Resize row": "Redimensionner la ligne",
  "Enter a valid row height or column width.": "Saisissez une hauteur de ligne ou une largeur de colonne valide.",
  "Collapse branch": "Replier la branche",
  "Expand branch": "Déplier la branche",
  "Mind map branches": "Branches de carte mentale",
  "hidden node": "nœud masqué",
  "hidden comment": "commentaire masqué",
  "hidden nodes": "nœuds masqués",
  "hidden comments": "commentaires masqués",
  "hidden in collapsed branches": "masqués dans des branches repliées",
  "Ctrl or Cmd + Enter to finish. Escape to cancel.": "Ctrl ou Cmd + Entrée pour terminer. Échap pour annuler.",
  "Moving a child without reassignment, or resizing it, switches to manual layout.": "Déplacer un enfant sans le rattacher, ou le redimensionner, active la disposition manuelle.",
  "Add child node": "Ajouter un nœud enfant",
  "Release to attach to": "Relâchez pour rattacher à",
  "Hold Ctrl/Cmd to move without reassigning": "Maintenez Ctrl/Cmd pour déplacer sans rattacher",
  "Moving branch without reassigning": "Déplacement de la branche sans rattachement",
  "Drag onto another node to move this branch · Hold Ctrl/Cmd to move freely": "Glissez sur un autre nœud pour rattacher cette branche · Maintenez Ctrl/Cmd pour déplacer librement",
  "Create mind map branches": "Créer des branches de carte mentale",
  "Add child above": "Ajouter un enfant au-dessus",
  "Add child to the right": "Ajouter un enfant à droite",
  "Add child below": "Ajouter un enfant en dessous",
  "Add child to the left": "Ajouter un enfant à gauche",
  "Add sibling node": "Ajouter un nœud frère",
  "Central idea": "Idée centrale",
  "New idea": "Nouvelle idée",
  "Untitled node": "Nœud sans titre",
  "Mind map controls": "Options de la carte mentale",
  "Move mind map branch": "Déplacer une branche de carte mentale",
  "Move branch earlier": "Avancer la branche",
  "Move branch later": "Reculer la branche",
  "Select a mind map node first.": "Sélectionnez d’abord un nœud de carte mentale.",
  "Layout nodes": "Organiser les nœuds",
  "Branch direction": "Direction des branches",
  "Branch lines": "Lignes des branches",
  "Keep current directions": "Conserver les directions actuelles",
  "Automatically lay out new branches": "Organiser automatiquement les nouvelles branches",
  "Find parent node": "Rechercher un nœud parent",
  "Make a separate mind map": "Créer une carte mentale séparée",
  "This mind map changed. Reopen its controls.": "Cette carte mentale a changé. Rouvrez ses options.",
  "A branch cannot be moved inside itself.": "Une branche ne peut pas être déplacée dans elle-même.",
  "The mind map is too large. Move it closer to the center or split a branch.": "La carte mentale est trop grande. Rapprochez-la du centre ou séparez une branche.",
  "Tab adds a child · Enter adds a sibling · Shift+Enter adds a line · Arrow keys navigate nodes": "Tab : ajouter un enfant · Entrée : ajouter un frère · Maj+Entrée : nouvelle ligne · Flèches : parcourir les nœuds",
  "Object link": "Lien de l’objet",
  "Edit cell": "Modifier la cellule",
  "Select one table first.": "Sélectionnez d’abord un tableau.",
  "Insert row above": "Insérer une ligne au-dessus",
  "Insert row below": "Insérer une ligne en dessous",
  "Delete selected rows": "Supprimer les lignes sélectionnées",
  "Insert column left": "Insérer une colonne à gauche",
  "Insert column right": "Insérer une colonne à droite",
  "Delete selected columns": "Supprimer les colonnes sélectionnées",
  "Clear cells": "Effacer les cellules",
  "Use latest value": "Utiliser la valeur actuelle",
  "This table is protected.": "Ce tableau est protégé.",
  "This table changed. Reopen its properties before applying these edits.": "Ce tableau a changé. Rouvrez ses propriétés avant d’appliquer ces modifications.",
  "Keep at least one row and one column.": "Conservez au moins une ligne et une colonne.",
  "Cell draft kept. Reopen the cell to review it.": "Brouillon conservé. Rouvrez la cellule pour le vérifier.",
  "This cell changed or is protected. Your draft is kept; copy it or use the latest value.": "Cette cellule a changé ou est protégée. Votre brouillon est conservé ; copiez-le ou utilisez la valeur actuelle.",
  "Arrows select cells · Shift extends selection · Enter edits · Tab moves · Escape cancels": "Flèches : sélectionner · Maj : étendre · Entrée : modifier · Tab : déplacer · Échap : annuler",
  "Object links": "Liens des objets",
  "Open object link": "Ouvrir le lien de l’objet",
  "Copy link to object": "Copier le lien vers l’objet",
  "Copy link to this object": "Copier le lien vers cet objet",
  "Object link copied.": "Lien de l’objet copié.",
  "Unable to create a link to this object.": "Impossible de créer un lien vers cet objet.",
  "No objects found.": "Aucun objet trouvé.",
  "Only people with board access can open this link.": "Seules les personnes ayant accès au tableau peuvent ouvrir ce lien.",
  "This link opens a board saved on this device.": "Ce lien ouvre un tableau enregistré sur cet appareil.",
  "Click a destination object on the canvas, choose one below, or enter a website URL.": "Cliquez sur un objet de destination, choisissez-en un ci-dessous ou saisissez une adresse Web.",
  "Link destination": "Destination du lien",
  "Find destination object": "Rechercher un objet de destination",
  "No object link.": "Aucun lien pour cet objet.",
  "The linked object is no longer on this board.": "L’objet lié ne se trouve plus sur ce tableau.",
  "Choose a valid frame.": "Choisissez un cadre valide.",
  "Another board is still being shared. Try again in a moment.": "Un autre tableau est encore en cours de partage. Réessayez dans un instant.",
  "Someone locked this object while you were editing it.": "Quelqu’un a verrouillé cet objet pendant que vous le modifiiez.",
  "This object changed. Open it again to edit it.": "Cet objet a changé. Rouvrez-le pour le modifier.",
  "This object changed or is protected. Reopen its link settings.": "Cet objet a changé ou est protégé. Rouvrez les réglages de son lien.",
  "Choose a different object.": "Choisissez un autre objet.",
  "This board is unavailable on this device. Check your boards or Trash.": "Ce tableau n’est pas disponible sur cet appareil. Consultez vos tableaux ou la corbeille.",
  "Go to linked object": "Aller à l’objet lié",
  "Invalid object link.": "Lien d’objet non valide.",
  Comments: "Commentaires",
  Comment: "Commentaire",
  "Comment (C)": "Commentaire (C)",
  "Add comment": "Ajouter un commentaire",
  "Board comments": "Commentaires du tableau",
  "Close comments": "Fermer les commentaires",
  "Search comments": "Rechercher des commentaires",
  "Show comments": "Afficher les commentaires",
  "Open comments": "Commentaires ouverts",
  "Resolved comments": "Commentaires résolus",
  "All comments": "Tous les commentaires",
  "New comment": "Nouveau commentaire",
  "Show pins": "Afficher les repères",
  Discussion: "Discussion",
  "Write a comment": "Rédiger un commentaire",
  "Write a reply": "Rédiger une réponse",
  "Enter to post · Shift+Enter for a new line": "Entrée pour publier · Maj+Entrée pour une nouvelle ligne",
  "Cancel edit": "Annuler la modification",
  "Post comment": "Publier le commentaire",
  "Resolve discussion": "Résoudre la discussion",
  "Reopen discussion": "Rouvrir la discussion",
  "No comments to show.": "Aucun commentaire à afficher.",
  "{count} discussion": "{count} discussion",
  "{count} discussions": "{count} discussions",
  "Deleted comment": "Commentaire supprimé",
  "Comment deleted": "Commentaire supprimé",
  "Edit comment": "Modifier le commentaire",
  "Delete comment": "Supprimer le commentaire",
  "Restore comment": "Restaurer le commentaire",
  "Save comment": "Enregistrer le commentaire",
  Reply: "Répondre",
  Edited: "Modifié",
  Resolved: "Résolu",
  Open: "Ouvert",
  "Draft comment": "Brouillon de commentaire",
  You: "Vous",
  "Show or hide comment pins": "Afficher ou masquer les repères de commentaire",
  "This discussion is no longer available.": "Cette discussion n’est plus disponible.",
  "This comment changed. Reopen it before editing.": "Ce commentaire a changé. Rouvrez-le avant de le modifier.",
  "This discussion has reached its reply limit.": "Cette discussion a atteint sa limite de réponses.",
  "This board has reached its comment limit.": "Ce tableau a atteint sa limite de commentaires.",
  "This comment's time is not valid.": "L’heure de ce commentaire n’est pas valide.",
  "Only the author can edit this comment.": "Seul l’auteur peut modifier ce commentaire.",
  "Invalid comment thread.": "Discussion non valide.",
  "Invalid comment message.": "Commentaire non valide.",
  "Mouse, trackpad, and touch": "Souris, pavé tactile et écran tactile",
  "Navigation mode": "Mode de navigation",
  "Auto-detect": "Détection automatique",
  Mouse: "Souris",
  Trackpad: "Pavé tactile",
  Touch: "Écran tactile",
  "Auto-detect recognizes wheel steps and smooth scrolling. Choose a device if scrolling feels wrong.": "La détection automatique distingue la molette du défilement fluide. Choisissez un périphérique si le défilement ne convient pas.",
  "Scroll to zoom. Right-drag, middle-drag, or Space-drag to pan.": "Utilisez la molette pour zoomer. Déplacez la vue avec le bouton droit, le bouton central ou Espace enfoncé.",
  "Scroll with two fingers to pan. Pinch or Ctrl/Cmd-scroll to zoom. Shift-scroll pans horizontally.": "Faites défiler avec deux doigts pour déplacer la vue. Pincez ou utilisez Ctrl/Cmd et le défilement pour zoomer. Maj et le défilement déplacent la vue horizontalement.",
  "Drag to pan and pinch to zoom. Tap an object to select it, then drag it to move. Hold for a moment, then drag to select several objects. Drawing tools still draw with one finger.": "Faites glisser pour déplacer la vue et pincez pour zoomer. Touchez un objet pour le sélectionner, puis déplacez-le. Maintenez le doigt un instant, puis faites glisser pour sélectionner plusieurs objets. Les outils de dessin utilisent toujours un doigt.",
  "This preference is saved on this device and shared with other open tabs.": "Cette préférence est enregistrée sur cet appareil et partagée avec les autres onglets ouverts.",
  Minimap: "Mini-carte",
  minimap: "mini-carte",
  "Minimap (M)": "Mini-carte (M)",
  "Close minimap": "Fermer la mini-carte",
  "Fit board": "Afficher tout",
  "Navigate board": "Parcourir le tableau",
  "Zoom in or out": "Zoom avant ou arrière",
  "Fit board / zoom to selection": "Afficher tout / zoom sur la sélection",
  "Click to jump or drag the visible area. Arrow keys pan; plus and minus zoom; Home fits the board; Escape closes the minimap.": "Cliquez pour vous déplacer ou faites glisser la zone visible. Les flèches déplacent la vue ; plus et moins changent le zoom ; Début affiche tout ; Échap ferme la mini-carte.",
  "Crop image": "Recadrer l’image",
  "Select one image.": "Sélectionnez une image.",
  "Invalid image crop.": "Recadrage d’image non valide.",
  "This crop exceeds the board size limits.": "Ce recadrage dépasse les dimensions maximales du tableau.",
  "This image has no editable area.": "Cette image n’a pas de zone modifiable.",
  "Cropping closed because the image changed or is no longer editable.": "Le recadrage a été fermé car l’image a changé ou n’est plus modifiable.",
  "Move crop area": "Déplacer la zone de recadrage",
  "Crop top left": "Recadrer en haut à gauche",
  "Crop top": "Recadrer en haut",
  "Crop top right": "Recadrer en haut à droite",
  "Crop right": "Recadrer à droite",
  "Crop bottom right": "Recadrer en bas à droite",
  "Crop bottom": "Recadrer en bas",
  "Crop bottom left": "Recadrer en bas à gauche",
  "Crop left": "Recadrer à gauche",
  "Reset original": "Rétablir l’original",
  "Aspect ratio": "Proportions",
  Freeform: "Libre",
  Original: "Original",
  Oval: "Ovale",
  Shape: "Forme",
  Left: "Gauche",
  Top: "Haut",
  "Exact crop (pixels)": "Recadrage précis (pixels)",
  "Apply crop": "Appliquer le recadrage",
  pixels: "pixels",
  "Drag the area or its handles. Arrow keys adjust by a pixel; Shift adjusts by ten. Alt/Option bypasses snapping.": "Faites glisser la zone ou ses poignées. Les flèches ajustent d’un pixel ; Maj de dix. Alt/Option désactive l’alignement automatique.",
  "Auto height": "Hauteur auto",
  "Automatic text height": "Hauteur automatique du texte",
  "Adjust height to fit the text. Resize to change its width.": "Adapter la hauteur au texte. Redimensionnez pour changer sa largeur.",
  "Height adjusts to the text. Change the width to rewrap it.": "La hauteur s’adapte au texte. Modifiez la largeur pour changer les retours à la ligne.",
  "Drag the corner horizontally to change text width. Alt/Option bypasses snapping.": "Faites glisser le coin horizontalement pour changer la largeur du texte. Alt/Option désactive l’alignement automatique.",
  "Text exceeds the board height limit. Widen the box or split the text into separate boxes.": "Le texte dépasse la hauteur maximale du tableau. Élargissez la zone ou répartissez le texte dans plusieurs zones.",
  "Command palette": "Palette de commandes",
  "Command palette (Ctrl/Cmd K)": "Palette de commandes (Ctrl/Cmd K)",
  "Search commands and boards": "Rechercher des commandes et des tableaux",
  "Commands and boards": "Commandes et tableaux",
  "No matching commands or boards. Try another word.": "Aucune commande ni aucun tableau correspondant. Essayez un autre mot.",
  "This command is no longer available.": "Cette commande n’est plus disponible.",
  "↑ ↓ to navigate · Enter to run · Esc to close": "↑ ↓ pour naviguer · Entrée pour exécuter · Échap pour fermer",
  "Keyboard shortcut": "Raccourci clavier",
  "Recent boards": "Tableaux récents",
  Create: "Créer",
  Edit: "Modifier",
  Arrange: "Organiser",
  Navigate: "Naviguer",
  Board: "Tableau",
  Help: "Aide",
  "Zoom to selection": "Zoom sur la sélection",
  "Nothing to undo.": "Rien à annuler.",
  "Nothing to redo.": "Rien à rétablir.",
  "Select shapes, notes, or text boxes.": "Sélectionnez des formes, des notes ou des zones de texte.",
  "Select an object with editable text.": "Sélectionnez un objet avec du texte modifiable.",
  "Select at least two objects or groups.": "Sélectionnez au moins deux objets ou groupes.",
  "Select at least three objects or groups.": "Sélectionnez au moins trois objets ou groupes.",
  "Select a group first.": "Sélectionnez d’abord un groupe.",
  "Auto-fit": "Ajustement auto",
  "Auto-fit text": "Ajuster automatiquement le texte",
  "Maximum font size": "Taille maximale de police",
  "Shrink text to fit. The font size is the maximum.": "Réduire le texte pour qu’il tienne. La taille de police est le maximum.",
  "Some text does not fit at the minimum size. Enlarge the object or shorten the text.": "Une partie du texte ne tient pas à la taille minimale. Agrandissez l’objet ou raccourcissez le texte.",
  "Quick diagram creation": "Création rapide de diagramme",
  "Quick connect top": "Connexion rapide en haut",
  "Quick connect right": "Connexion rapide à droite",
  "Quick connect bottom": "Connexion rapide en bas",
  "Quick connect left": "Connexion rapide à gauche",
  "Click to add a connected object or connect a nearby one. Drag to choose another target. Escape cancels.": "Cliquez pour ajouter un objet connecté ou relier un objet proche. Faites glisser pour choisir une autre cible. Échap annule.",
  "Add connected object": "Ajouter un objet connecté",
  "Connect to": "Connecter à",
  "Select one shape, sticky note, or text box.": "Sélectionnez une forme, une note adhésive ou une zone de texte.",
  Shapes: "Formes",
  "Shapes (S)": "Formes (S)",
  "Change shape": "Changer de forme",
  Diamond: "Losange",
  Triangle: "Triangle",
  Parallelogram: "Parallélogramme",
  Hexagon: "Hexagone",
  Star: "Étoile",
  Cylinder: "Cylindre",
  Terminator: "Terminaison",
  Process: "Processus",
  "Start or end": "Début ou fin",
  Decision: "Décision",
  "Input or output": "Entrée ou sortie",
  Database: "Base de données",
  Preparation: "Préparation",
  "Basic shape": "Forme simple",
  "Invalid shape.": "Forme non valide.",
  // Board validation, shown when an imported or migrated board is rejected.
  "The board contains an invalid object.": "Le tableau contient un objet non valide.",
  "Invalid object rotation.": "Rotation d’objet non valide.",
  "Unsupported image format.": "Format d’image non pris en charge.",
  "Invalid drawing.": "Dessin non valide.",
  "Invalid text highlight.": "Surlignage de texte non valide.",
  "Invalid font family.": "Police non valide.",
  "Invalid font size.": "Taille de police non valide.",
  "Invalid text style.": "Style de texte non valide.",
  "Invalid text color.": "Couleur de texte non valide.",
  "Invalid text alignment.": "Alignement du texte non valide.",
  "Invalid text formatting.": "Mise en forme du texte non valide.",
  "Invalid text list.": "Liste de texte non valide.",
  "Invalid object tags.": "Étiquettes d’objet non valides.",
  "Invalid table.": "Tableau de données non valide.",
  "Invalid table dimensions.": "Dimensions du tableau de données non valides.",
  "Invalid attachment.": "Pièce jointe non valide.",
  "Object dimensions must be positive.": "Les dimensions de l’objet doivent être positives.",
  "Invalid object relationship.": "Relation entre objets non valide.",
  "Invalid object lock.": "Verrouillage d’objet non valide.",
  "Invalid frame order.": "Ordre des cadres non valide.",
  "Invalid mind map node.": "Nœud de carte mentale non valide.",
  "Invalid mind map collapse state.": "État replié de la carte mentale non valide.",
  "Invalid frame membership.": "Appartenance à un cadre non valide.",
  "Invalid connector.": "Connecteur non valide.",
  "A board can contain at most 5,000 objects.": "Un tableau peut contenir au maximum 5 000 objets.",
  "Bulk sticky notes": "Notes adhésives en série",
  "The table is too tall. Use a smaller font or fewer lines.": "La table est trop haute. Utilisez une police plus petite ou moins de lignes.",
  "Paste spreadsheet": "Coller des cellules",
  "Choose how to add these cells. Blank cells keep their positions.": "Choisissez comment ajouter ces cellules. Les cellules vides conservent leur position.",
  Ideas: "Idées",
  "One sticky note per line. Empty lines are skipped.": "Une note adhésive par ligne. Les lignes vides sont ignorées.",
  "Paste as": "Coller en tant que",
  "Sticky notes": "Notes adhésives",
  "Plain text": "Texte brut",
  "Sticky color": "Couleur des notes",
  "Cluster sticky notes": "Regrouper les notes adhésives",
  "Cluster by": "Regrouper par",
  Color: "Couleur",
  "One named cluster": "Un regroupement nommé",
  "Cluster name": "Nom du regroupement",
  Cluster: "Regroupement",
  "Create clusters": "Créer les regroupements",
  "No tag": "Sans étiquette",
  notes: "notes",
  clusters: "regroupements",
  "extra copies": "copies supplémentaires",
  "extra copy": "copie supplémentaire",
  note: "note",
  cluster: "regroupement",
  "Select sticky notes first.": "Sélectionnez d’abord des notes adhésives.",
  "Choose a clustering method.": "Choisissez une méthode de regroupement.",
  "The cluster name changed. Reopen clustering.": "Le nom du regroupement a changé. Rouvrez le regroupement.",
  "The selected notes changed. Reopen clustering.": "Les notes sélectionnées ont changé. Rouvrez le regroupement.",
  "Select sticky notes outside a mind map.": "Sélectionnez des notes adhésives qui ne font pas partie d’une carte mentale.",
  "Enter a cluster name of up to 200 characters.": "Saisissez un nom de regroupement de 200 caractères maximum.",
  "These clusters would exceed the board limit of 5,000 objects.": "Ces regroupements dépasseraient la limite de 5 000 objets du tableau.",
  "These clusters would exceed the board geometry limit.": "Ces regroupements dépasseraient les limites géométriques du tableau.",
  "The notes changed. Review the updated clusters and try again.": "Les notes ont changé. Vérifiez les regroupements actualisés, puis réessayez.",
  "Selected notes move into editable frames. Notes leave their previous groups and frames; other objects stay in place. Notes with several tags are copied into each matching cluster.": "Les notes sélectionnées sont déplacées dans des cadres modifiables. Elles quittent leurs groupes et cadres précédents ; les autres objets restent en place. Les notes portant plusieurs étiquettes sont copiées dans chaque regroupement correspondant.",
  Yellow: "Jaune",
  Red: "Rouge",
  Lime: "Vert citron",
  Cyan: "Cyan",
  Pink: "Rose",
  Gray: "Gris",
  Violet: "Violet",
  "Dark green": "Vert foncé",
  "Dark blue": "Bleu foncé",
  "Dark gray": "Gris foncé",
  Black: "Noir",
  Green: "Vert",
  Blue: "Bleu",
  Purple: "Violet",
  Peach: "Pêche",
  White: "Blanc",
  // Sticky note colors, which name clusters grouped by color.
  Butter: "Beurre",
  Sage: "Sauge",
  Lilac: "Lilas",
  Cells: "Cellules",
  "Content preview": "Aperçu du contenu",
  "Cluster preview": "Aperçu des regroupements",
  "Add to board": "Ajouter au tableau",
  "Paste up to 50 rows and 100 columns at a time.": "Collez jusqu’à 50 lignes et 100 colonnes à la fois.",
  "Tables support up to 20 rows, 12 columns, and 2,000 characters per cell.": "Les tables acceptent jusqu’à 20 lignes, 12 colonnes et 2 000 caractères par cellule.",
  "Paste up to 1 million characters at a time.": "Collez jusqu’à 1 million de caractères à la fois.",
  "Check the quotes in the pasted spreadsheet cells.": "Vérifiez les guillemets dans les cellules collées.",
  "Paste one spreadsheet range at a time.": "Collez une plage de cellules à la fois.",
  "Use up to 20,000 characters per sticky note.": "Utilisez jusqu’à 20 000 caractères par note adhésive.",
  "Copy as image": "Copier en tant qu’image",
  "Copy as image (Ctrl/Cmd Shift C)": "Copier en tant qu’image (Ctrl/Cmd Maj C)",
  "Copy image": "Copier l’image",
  "Download PNG": "Télécharger le PNG",
  "Image of selected objects": "Image des objets sélectionnés",
  "Clipboard access is unavailable. Download the PNG or try copying again.": "L’accès au presse-papiers est indisponible. Téléchargez le PNG ou réessayez de copier.",
  "Could not copy the image. Use Copy as image to try again.": "Impossible de copier l’image. Utilisez Copier en tant qu’image pour réessayer.",
  "Image copied. Paste it into another app or board.": "Image copiée. Collez-la dans une autre application ou un tableau.",
  "An image copy is already in progress.": "Une copie d’image est déjà en cours.",
  "Select objects to copy as an image.": "Sélectionnez les objets à copier en tant qu’image.",
  "Copying selection as an image…": "Copie de la sélection en tant qu’image…",
  "Could not prepare the image. Please try again.": "Impossible de préparer l’image. Veuillez réessayer.",
  "Your browser cannot copy images here. Download the PNG instead.": "Votre navigateur ne peut pas copier d’images ici. Téléchargez le PNG.",
  "Connection line formatting": "Mise en forme des lignes de connexion",
  "Copy style": "Copier le style",
  "Font family": "Police de caractères",
  "Paste style": "Coller le style",
  "Copy style (Ctrl/Cmd Alt/Option C)": "Copier le style (Ctrl/Cmd Alt/Option C)",
  "Paste style (Ctrl/Cmd Alt/Option V)": "Coller le style (Ctrl/Cmd Alt/Option V)",
  "Select one object with a copyable style.": "Sélectionnez un objet dont le style peut être copié.",
  "Style copied. Select objects and paste style.": "Style copié. Sélectionnez des objets et collez le style.",
  "Copy a style first.": "Copiez d’abord un style.",
  "The copied style does not apply to this selection.": "Le style copié ne s’applique pas à cette sélection.",
  "This style is already applied.": "Ce style est déjà appliqué.",
  "Style pasted.": "Style collé.",
  Path: "Tracé",
  Straight: "Droit",
  Elbow: "Coudé",
  Curved: "Courbe",
  Stroke: "Trait",
  Solid: "Continu",
  Dashed: "Tirets",
  Dotted: "Pointillé",
  Thickness: "Épaisseur",
  Start: "Début",
  End: "Fin",
  None: "Aucun",
  Arrowhead: "Pointe de flèche",
  Dot: "Point",
  "Connection endpoints": "Extrémités de connexion",
  "Free endpoint": "Extrémité libre",
  "Start object": "Objet de départ",
  "End object": "Objet d’arrivée",
  "Drag either round handle to reconnect. Hold Alt/Option to detach, or Shift for a straight angle.": "Faites glisser une poignée ronde pour reconnecter. Maintenez Alt/Option pour détacher, ou Maj pour un angle droit.",
  "Choose two different objects.": "Choisissez deux objets différents.",
  "Drag between objects to connect · Alt/Option for a free endpoint": "Reliez les objets par glissement · Alt/Option pour une extrémité libre",
  "Invalid line style.": "Style de ligne invalide.",
  "Invalid line thickness.": "Épaisseur de ligne invalide.",
  "Open to rename": "Ouvrir pour renommer",
  "Share board": "Partager le tableau",
  "Shared board": "Tableau partagé",
  Participants: "Participants",
  Editing: "Modification",
  "Join shared board": "Rejoindre un tableau partagé",
  "Board link": "Lien du tableau",
  "Join board": "Rejoindre le tableau",
  "Sign in with Puter to join this board.": "Connectez-vous à Puter pour rejoindre ce tableau.",
  "Can edit": "Peut modifier",
  "Can view": "Peut consulter",
  Owner: "Propriétaire",
  Removed: "Retiré",
  "Access for": "Accès pour",
  "Link access": "Accès par lien",
  "Create invitation": "Créer une invitation",
  "Copy link": "Copier le lien",
  "Revoke invitation links": "Révoquer les liens d’invitation",
  "Link copied.": "Lien copié.",
  "Copy the selected link.": "Copiez le lien sélectionné.",
  "This board is read-only.": "Ce tableau est en lecture seule.",
  "Only the owner or a facilitator can invite new participants.": "Seuls le propriétaire du tableau ou un animateur peuvent inviter de nouveaux participants.",
  "Anyone signed in with this invitation can join.": "Toute personne connectée disposant de cette invitation peut rejoindre le tableau.",
  "Create an invitation to share this access.": "Créez une invitation pour partager cet accès.",
  "Invitation links revoked. Existing members retain access.": "Liens d’invitation révoqués. Les membres actuels conservent leur accès.",
  "Changes are shared as you type. Escape to finish.": "Les modifications sont partagées pendant la saisie. Échap pour terminer.",
  "Preparing collaboration…": "Préparation de la collaboration…",
  "Starting collaboration…": "Démarrage de la collaboration…",
  "Sharing failed · try again": "Échec du partage · réessayez",
  "The collaboration server bundle could not load.": "Le module du serveur de collaboration n’a pas pu être chargé.",
  "Invalid collaboration server bundle.": "Module du serveur de collaboration non valide.",
  "Could not create a restricted collaboration credential.": "Impossible de créer un identifiant de collaboration restreint.",
  "Connecting to shared board…": "Connexion au tableau partagé…",
  "Still connecting to the shared board. Try again in a moment.": "Connexion au tableau partagé en cours. Réessayez dans un instant.",
  "Sharing update could not finish. Reopen this board to retry.": "La mise à jour du partage n’a pas abouti. Rouvrez ce tableau pour réessayer.",
  "Saving shared changes…": "Enregistrement des modifications partagées…",
  "Saved · live": "Enregistré · en direct",
  "Saved · periodic sync": "Enregistré · synchronisation périodique",
  "Connected · periodic sync": "Connecté · synchronisation périodique",
  "Offline · changes saved on this device": "Hors ligne · modifications enregistrées sur cet appareil",
  "Some changes could not be saved because they conflicted with the shared board.": "Certaines modifications n’ont pas pu être enregistrées, car elles étaient en conflit avec le tableau partagé.",
  "Board unavailable · local changes retained": "Tableau indisponible · modifications locales conservées",
  "Access changed · local changes retained": "Accès modifié · modifications locales conservées",
  "Local recovery failed. Keep this tab open.": "La récupération locale a échoué. Gardez cet onglet ouvert.",
  "Could not connect · local copy available": "Connexion impossible · copie locale disponible",
  "Setting up sharing…": "Configuration du partage…",
  "Uploading the board…": "Envoi du tableau…",
  "This can take a few seconds. You can close this and keep working.": "Cela peut prendre quelques secondes. Vous pouvez fermer cette fenêtre et continuer à travailler.",
  "Sharing is ready. Select Share board to invite people.": "Le partage est prêt. Sélectionnez Partager le tableau pour inviter des personnes.",
  "Invalid board invitation.": "Invitation au tableau non valide.",
  "Invalid Whiteboard server address.": "Adresse de serveur Whiteboard non valide.",
  "The collaboration server is still starting. Try Share again shortly.": "Le serveur de collaboration démarre encore. Réessayez Partager dans un instant.",
  "Your Puter account changed. Reopen the shared board.": "Votre compte Puter a changé. Rouvrez le tableau partagé.",
  "Could not synchronize this board.": "Impossible de synchroniser ce tableau.",
  "Could not reach the shared board. Check your connection and try again.": "Impossible de joindre le tableau partagé. Vérifiez votre connexion et réessayez.",
  "The server did not acknowledge this edit.": "Le serveur n’a pas confirmé cette modification.",
  "Find on board": "Rechercher dans le tableau",
  "Find on board (Ctrl/Cmd F)": "Rechercher dans le tableau (Ctrl/Cmd F)",
  "Search this board": "Rechercher dans ce tableau",
  "Close search": "Fermer la recherche",
  "All content": "Tout le contenu",
  "Content type": "Type de contenu",
  "Previous result": "Résultat précédent",
  "Next result": "Résultat suivant",
  "Previous page": "Page précédente",
  "Next page": "Page suivante",
  "Select on board": "Sélectionner sur le tableau",
  "Search text, links, file names, and table cells.": "Recherchez du texte, des liens, des noms de fichiers et des cellules.",
  "Enter: next result · Shift+Enter: previous · Escape: close": "Entrée : suivant · Maj+Entrée : précédent · Échap : fermer",
  "Untitled object": "Objet sans titre",
  Attachment: "Pièce jointe",
  Drawing: "Dessin",
  "Adding files…": "Ajout des fichiers…",
  "Files added.": "Fichiers ajoutés.",
  "Drop content here": "Déposez le contenu ici",
  "Images, files, text, and links": "Images, fichiers, texte et liens",
  "Copy, cut, or paste objects": "Copier, couper ou coller des objets",
  "Ctrl or Cmd + C / X / V": "Ctrl ou Cmd + C / X / V",
  "This selection is too large to copy. Export a board file instead.": "Cette sélection est trop volumineuse pour être copiée. Exportez un fichier de tableau.",
  "This selection is too large to paste.": "Cette sélection est trop volumineuse pour être collée.",
  "This clipboard content is not supported.": "Ce contenu du presse-papiers n’est pas pris en charge.",
  "Paste up to 20,000 characters at a time.": "Collez jusqu’à 20 000 caractères à la fois.",
  "Could not read this file.": "Impossible de lire ce fichier.",
  "Add up to 20 files and 50 MB at a time.": "Ajoutez jusqu’à 20 fichiers et 50 Mo à la fois.",
  "Could not decode an image.": "Impossible de décoder une image.",
  "Choose an image with fewer than 40 million pixels.": "Choisissez une image de moins de 40 millions de pixels.",
  "A board can contain up to 5,000 objects.": "Un tableau peut contenir jusqu’à 5 000 objets.",
  "Could not add these files.": "Impossible d’ajouter ces fichiers.",
  "Could not copy these objects. Your board is unchanged.": "Impossible de copier ces objets. Votre tableau est inchangé.",
  "Could not paste this content.": "Impossible de coller ce contenu.",
  "Choose a tool, then click the canvas. Double-click an object to edit its text. Drag a corner to resize. Paste text, links, or images, or drop files onto the canvas.": "Choisissez un outil, puis cliquez sur le tableau. Double-cliquez sur un objet pour modifier son texte. Faites glisser un coin pour le redimensionner. Collez du texte, des liens ou des images, ou déposez des fichiers sur le tableau.",
  "Editing text": "Modification du texte",
  Done: "Terminé",
  "Text formatting": "Mise en forme du texte",
  Bold: "Gras",
  Italic: "Italique",
  Underline: "Souligné",
  Strikethrough: "Barré",
  Lists: "Listes",
  "Text links": "Liens du texte",
  "Insert or edit text link": "Insérer ou modifier un lien dans le texte",
  "Link URL": "Adresse du lien",
  "Apply link": "Appliquer le lien",
  "Edit link": "Modifier le lien",
  Previous: "Précédent",
  Next: "Suivant",
  "Remove link": "Supprimer le lien",
  "Open link in new tab": "Ouvrir le lien dans un nouvel onglet",
  "The selected text changed. Select it again.": "Le texte sélectionné a changé. Sélectionnez-le à nouveau.",
  "Select one text object.": "Sélectionnez un objet contenant du texte.",
  "Ctrl/Cmd + Alt/Option + K": "Ctrl/Cmd + Alt/Option + K",
  "List formatting": "Mise en forme des listes",
  "Bulleted list": "Liste à puces",
  "Numbered list": "Liste numérotée",
  "Increase indent": "Augmenter le retrait",
  "Decrease indent": "Diminuer le retrait",
  "In lists, Tab changes indent, Shift+Enter continues an item, and Enter on an empty item exits the list.": "Dans une liste, Tab change le retrait, Maj+Entrée continue un élément et Entrée sur un élément vide quitte la liste.",
  "Indent / outdent a list item": "Augmenter / diminuer le retrait d’un élément de liste",
  "Continue a list item on a new line": "Continuer un élément de liste sur une nouvelle ligne",
  "Tab / Shift + Tab": "Tab / Maj + Tab",
  "Shift + Enter": "Maj + Entrée",
  "Shift + C": "Maj + C",
  "Shift + N": "Maj + N",
  "Space / right / middle + drag": "Espace / clic droit / clic central + glisser",
  "Ctrl/Cmd + Plus/Minus": "Ctrl/Cmd + Plus/Moins",
  "Arrow keys": "Touches fléchées",
  "Alt / Option + drag": "Alt / Option + glisser",
  "Alt / Option + Arrow keys": "Alt / Option + touches fléchées",
  "Alt / Option during drag": "Alt / Option pendant le glissement",
  Escape: "Échap",
  "Shift + resize": "Maj + redimensionnement",
  "Ctrl/Cmd + Alt/Option + Shift + Plus/Minus": "Ctrl/Cmd + Alt/Option + Maj + Plus/Moins",
  Enter: "Entrée",
  "Ctrl/Cmd + Shift + Down / Up": "Ctrl/Cmd + Maj + Bas / Haut",
  "Ctrl/Cmd + Alt/Option + Shift + K": "Ctrl/Cmd + Alt/Option + Maj + K",
  "Ctrl/Cmd + Alt/Option + Shift + C": "Ctrl/Cmd + Alt/Option + Maj + C",
  "Ctrl or Cmd + Z": "Ctrl ou Cmd + Z",
  "Ctrl or Cmd + D": "Ctrl ou Cmd + D",
  "Ctrl or Cmd + Shift + L": "Ctrl ou Cmd + Maj + L",
  "Ctrl/Cmd + Shift + C": "Ctrl/Cmd + Maj + C",
  "Ctrl or Cmd + [ / ]": "Ctrl ou Cmd + [ / ]",
  "Ctrl or Cmd + Shift + [ / ]": "Ctrl ou Cmd + Maj + [ / ]",
  "Ctrl/Cmd + Backspace": "Ctrl/Cmd + Retour arrière",
  "Delete / Backspace": "Suppr / Retour arrière",
  Find: "Rechercher",
  Delete: "Supprimer",
  Share: "Partager",
  View: "Affichage",
  Selection: "Sélection",
  "Previous results": "Résultats précédents",
  "Next results": "Résultats suivants",
  "Selected objects": "Objets sélectionnés",
  "Selected region": "Zone sélectionnée",
  Row: "Ligne",
  Column: "Colonne",
  "Highlight text": "Surligner le texte",
  "Remove highlight": "Supprimer le surlignage",
  "No highlight": "Sans surlignage",
  "Text color": "Couleur du texte",
  "Custom color": "Couleur personnalisée",
  "Automatic text color": "Couleur du texte automatique",
  "Text alignment": "Alignement du texte",
  "Align text left": "Texte à gauche",
  "Align text center": "Texte centré",
  "Align text right": "Texte à droite",
  "Font size": "Taille du texte",
  Mixed: "Mixte",
  "Object properties": "Propriétés de l’objet",
  "Edit text on canvas": "Modifier le texte sur le tableau",
  "Finish editing": "Terminer la modification",
  "Cancel text edit": "Annuler la modification du texte",
  "Ctrl or Cmd + Enter to finish. Escape to cancel. Enter adds a new line.": "Ctrl ou Cmd + Entrée pour terminer. Échap pour annuler. Entrée ajoute une ligne.",
  "Board library": "Bibliothèque de tableaux",
  "Recovered board": "Tableau récupéré",
  "Space + drag": "Espace + glisser",
  "Ctrl or Cmd + scroll": "Ctrl ou Cmd + défilement",
  "Shift + click": "Maj + clic",
  "Ctrl or Cmd + Shift + Z": "Ctrl ou Cmd + Maj + Z",
  "Fullscreen is unavailable. Presentation remains open.": "Le plein écran est indisponible. La présentation reste ouverte.",
  "Could not restore this version.": "Impossible de restaurer cette version.",
  "Could not export this board.": "Impossible d’exporter ce tableau.",
  "This area is too large for a readable PDF. Export smaller frames or a selected region.": "Cette zone est trop grande pour un PDF lisible. Exportez des cadres plus petits ou une région sélectionnée.",
  "Too many PDF pages. Export fewer frames at a time.": "Trop de pages PDF. Exportez moins de cadres à la fois.",
  "Choose a file smaller than 100 MB.": "Choisissez un fichier de moins de 100 Mo.",
  "Whiteboard home": "Accueil Whiteboard",
  "PERSONAL WORKSPACE": "ESPACE PERSONNEL",
  "All boards": "Tous les tableaux",
  Favorites: "Favoris",
  Trash: "Corbeille",
  "Puter cloud": "Nuage Puter",
  Appearance: "Apparence",
  System: "Système",
  Light: "Clair",
  Dark: "Sombre",
  "Powered by Puter": "Propulsé par Puter",
  Workspace: "Espace de travail",
  "Keyboard shortcuts": "Raccourcis clavier",
  "Personal workspace": "Espace personnel",
  "Make room for your ideas.": "Faites place à vos idées.",
  "Think freely, connect the dots, and see the bigger picture.": "Pensez librement, reliez vos idées et prenez du recul.",
  "Start with a little inspiration": "Un peu d’inspiration pour commencer",
  "Make it your own": "À votre image",
  "Blank board": "Tableau vierge",
  "A fresh start": "Un nouveau départ",
  Brainstorm: "Remue-méninges",
  "Let your ideas wander": "Laissez libre cours à vos idées",
  "Mind map": "Carte mentale",
  "Connect the dots": "Reliez vos idées",
  "Simple planner": "Planificateur simple",
  "One step at a time": "Une étape à la fois",
  "Your boards": "Vos tableaux",
  "Favorite boards": "Tableaux favoris",
  "Your thoughts, all in one place.": "Toutes vos idées au même endroit.",
  "New board": "Nouveau tableau",
  "Search boards": "Rechercher des tableaux",
  "Search your boards": "Rechercher dans vos tableaux",
  "Sort boards": "Trier les tableaux",
  "Last edited": "Dernière modification",
  Name: "Nom",
  "Import board file": "Importer un tableau",
  "A world of possibility": "Un monde de possibilités",
  "No boards found": "Aucun tableau trouvé",
  "Keep your best ideas close": "Gardez vos meilleures idées à portée de main",
  "Your next idea starts here": "Votre prochaine idée commence ici",
  "Try a different name.": "Essayez un autre nom.",
  "Star a board to find it here.": "Ajoutez un tableau aux favoris pour le retrouver ici.",
  "Create a board or choose a template above.": "Créez un tableau ou choisissez un modèle ci-dessus.",
  "Tips & shortcuts": "Conseils et raccourcis",
  "Untitled board": "Tableau sans titre",
  "Back to boards": "Retour aux tableaux",
  "Board name": "Nom du tableau",
  "Saved on this device": "Enregistré sur cet appareil",
  "Save to Puter": "Enregistrer sur Puter",
  "Export board": "Exporter le tableau",
  "Drawing tools": "Outils de création",
  Select: "Sélectionner",
  Pan: "Déplacer la vue",
  "Sticky note": "Note adhésive",
  Text: "Texte",
  Rectangle: "Rectangle",
  Ellipse: "Ellipse",
  Arrow: "Flèche",
  Draw: "Dessiner",
  Frame: "Cadre",
  "Add image": "Ajouter une image",
  "Personal board": "Tableau personnel",
  "Board objects": "Objets du tableau",
  "Zoom out": "Zoom arrière",
  "Zoom in": "Zoom avant",
  "Reset zoom to 100 percent": "Rétablir le zoom à 100 %",
  "Fit board to screen": "Ajuster le tableau à l’écran",
  "A fresh space for a fresh idea.": "Un nouvel espace pour une nouvelle idée.",
  "Add a sticky note, sketch a thought, or just start somewhere.": "Ajoutez une note, esquissez une idée ou lancez-vous.",
  "Add your first note": "Ajouter votre première note",
  "Butter color": "Couleur beurre",
  "Sage color": "Couleur sauge",
  "Blue color": "Couleur bleue",
  "Lilac color": "Couleur lilas",
  "Peach color": "Couleur pêche",
  "White color": "Couleur blanche",
  "Edit selected object": "Modifier l’objet sélectionné",
  "Duplicate selection": "Dupliquer la sélection",
  "Duplicate left": "Dupliquer à gauche",
  "Duplicate right": "Dupliquer à droite",
  "Duplicate above": "Dupliquer au-dessus",
  "Duplicate below": "Dupliquer en dessous",
  "Drag a copy": "Faire glisser une copie",
  "Duplicate in a direction": "Dupliquer dans une direction",
  "The duplicate would be outside the board limits.": "La copie serait en dehors des limites du tableau.",
  "Bring to front": "Mettre au premier plan",
  "Delete selection": "Supprimer la sélection",
  "Select and move · Double-click to edit · Space to pan": "Sélectionner et déplacer · Double-clic pour modifier · Espace pour naviguer",
  "Drag to move around your board": "Faites glisser pour vous déplacer dans le tableau",
  "Draw freely on the canvas": "Dessinez librement sur le tableau",
  "This drawing is full. Draw again to continue.": "Ce dessin est plein. Dessinez de nouveau pour continuer.",
  "Click the canvas to add a sticky note": "Cliquez sur le tableau pour ajouter une note adhésive",
  "Click the canvas to add text": "Cliquez sur le tableau pour ajouter du texte",
  "Click the canvas to add a rectangle": "Cliquez sur le tableau pour ajouter un rectangle",
  "Click the canvas to add an ellipse": "Cliquez sur le tableau pour ajouter une ellipse",
  "Click the canvas to add a frame": "Cliquez sur le tableau pour ajouter un cadre",
  "Click the canvas to add a comment": "Cliquez sur le tableau pour ajouter un commentaire",
  "Drag across the board to choose the area to export": "Faites glisser sur le tableau pour choisir la zone à exporter",
  "Drag from start to end": "Faites glisser du début à la fin",
  "Your text": "Votre texte",
  "Close dialog": "Fermer la fenêtre",
  Width: "Largeur",
  Height: "Hauteur",
  "Save changes": "Enregistrer les modifications",
  "Take your ideas with you": "Emportez vos idées",
  "Export a visual snapshot or a fully editable backup.": "Exportez une image ou une sauvegarde modifiable.",
  "PNG image": "Image PNG",
  "JPEG image": "Image JPEG",
  "PDF document": "Document PDF",
  "Whiteboard file": "Fichier Whiteboard",
  "Import it later and keep creating": "Importez-le plus tard pour continuer",
  "Board options": "Options du tableau",
  "Delete local board": "Mettre à la corbeille",
  Duplicate: "Dupliquer",
  "Save name": "Enregistrer le nom",
  "Delete this local board?": "Mettre ce tableau à la corbeille?",
  "Keep board": "Conserver le tableau",
  "Delete board": "Mettre à la corbeille",
  "Restore board": "Restaurer le tableau",
  "Cloud boards": "Tableaux dans le nuage",
  "Your Puter cloud": "Votre nuage Puter",
  "Connect to Puter": "Se connecter à Puter",
  "Disconnect Puter": "Déconnecter Puter",
  "Loading your boards…": "Chargement de vos tableaux…",
  "No cloud boards yet. Open a board and choose Save to Puter.": "Aucun tableau dans le nuage. Ouvrez un tableau et choisissez Enregistrer sur Puter.",
  "Select a file to open its latest saved version.": "Sélectionnez un fichier pour ouvrir sa dernière version.",
  "Keep boards in your own Puter drive. Connect to open a cloud board, or save a board from its canvas.": "Conservez vos tableaux dans votre espace Puter. Connectez-vous pour ouvrir un tableau, ou enregistrez-le depuis l’éditeur.",
  "Saving…": "Enregistrement…",
  "Saved locally": "Enregistré localement",
  "Storage full": "Stockage plein",
  "Saving to Puter…": "Enregistrement sur Puter…",
  "Saved to Puter": "Enregistré sur Puter",
  "Cloud save failed": "Échec de l’enregistrement dans le nuage",
  "Could not move this board to the trash.": "Impossible de mettre ce tableau à la corbeille.",
  // Added to the names of duplicated and imported boards.
  copy: "copie",
  imported: "importé",
  "Could not save the copy on this device.": "Impossible d’enregistrer la copie sur cet appareil.",
  "Could not save locally. Export your board to keep a copy.": "Enregistrement local impossible. Exportez votre tableau pour en conserver une copie.",
  "Cloud save failed. Your local copy is safe. Use Save to Puter to retry.": "Échec de l’enregistrement sur Puter. Votre copie locale est conservée. Réessayez avec Enregistrer sur Puter.",
  "Board imported.": "Tableau importé.",
  "Disconnected. Your local boards are still available.": "Déconnexion effectuée. Vos tableaux locaux restent disponibles.",
  "A newer local copy was kept.": "La copie locale plus récente a été conservée.",
  Language: "Langue",
  "More tools": "Autres outils",
  Link: "Lien",
  Table: "Tableau de données",
  "File attachment": "Pièce jointe",
  "Add link": "Ajouter un lien",
  "Add table": "Ajouter un tableau de données",
  "Attach file": "Joindre un fichier",
  "Open link": "Ouvrir le lien",
  "Download attachment": "Télécharger la pièce jointe",
  URL: "Adresse URL",
  Label: "Libellé",
  Rows: "Lignes",
  Columns: "Colonnes",
  "Add row": "Ajouter une ligne",
  "Add column": "Ajouter une colonne",
  "Remove last row": "Supprimer la dernière ligne",
  "Remove last column": "Supprimer la dernière colonne",
  "Table cells": "Cellules du tableau",
  "File name": "Nom du fichier",
  "Choose a file smaller than 10 MB.": "Choisissez un fichier de moins de 10 Mo.",
  "Enter a valid http or https link.": "Saisissez une adresse http ou https valide.",
  "Group selection": "Grouper la sélection",
  "Ungroup selection": "Dissocier la sélection",
  "Connect selected objects": "Relier les objets sélectionnés",
  "Select exactly two objects to connect.": "Sélectionnez exactement deux objets à relier.",
  "Select at least two objects to group.": "Sélectionnez au moins deux objets à grouper.",
  "Organize selection": "Organiser la sélection",
  "Lock selection": "Verrouiller la sélection",
  "Lock frame": "Verrouiller le cadre",
  "Unlock selection": "Déverrouiller la sélection",
  "Lock or unlock selection": "Verrouiller ou déverrouiller la sélection",
  "Unlock all objects": "Déverrouiller tous les objets",
  "Protected selection": "Sélection protégée",
  "Unlock to move, edit, or delete.": "Déverrouillez pour déplacer, modifier ou supprimer.",
  "Unlock protected objects before changing this selection.": "Déverrouillez les objets protégés avant de modifier cette sélection.",
  "Workshop content hidden from you was left out of the copy.": "Le contenu d’atelier qui vous est masqué n’a pas été inclus dans la copie.",
  "Hidden object": "Objet masqué",
  "Choose a visible object.": "Choisissez un objet visible.",
  "Hidden objects cannot be copied.": "Les objets masqués ne peuvent pas être copiés.",
  "Selection locked.": "Sélection verrouillée.",
  "Selection unlocked.": "Sélection déverrouillée.",
  "All objects unlocked.": "Tous les objets sont déverrouillés.",
  "No locked objects.": "Aucun objet verrouillé.",
  "Frame locked. Its contents remain editable.": "Cadre verrouillé. Son contenu reste modifiable.",
  Locked: "Verrouillé",
  "Rotated selections keep their proportions. Alt/Option bypasses snapping.": "Les sélections pivotées conservent leurs proportions. Alt/Option désactive l’alignement.",
  "Rotate selection": "Faire pivoter la sélection",
  "Angle (degrees)": "Angle (degrés)",
  "Rotate by (degrees)": "Rotation relative (degrés)",
  "Reset angle": "Réinitialiser l’angle",
  "Apply rotation": "Appliquer la rotation",
  "Select shapes, text, images, cards, or drawings to rotate.": "Sélectionnez des formes, du texte, des images, des cartes ou des dessins à faire pivoter.",
  "Drag the rotation handle below the left corner. Hold Shift to snap to 15° steps. Escape cancels.": "Faites glisser la poignée de rotation sous le coin gauche. Maintenez Maj pour des pas de 15°. Échap annule.",
  "Enter a valid angle.": "Saisissez un angle valide.",
  "This rotation exceeds the board limits.": "Cette rotation dépasse les limites du tableau.",
  "Keep proportions when resizing rotated objects together.": "Conservez les proportions pour redimensionner ensemble des objets pivotés.",
  "Resize selection": "Redimensionner la sélection",
  "Resize frame": "Redimensionner le cadre",
  "Frame contents stay in place.": "Le contenu du cadre reste en place.",
  "Resize objects and their spacing together.": "Redimensionnez ensemble les objets et leur espacement.",
  "Keep proportions": "Conserver les proportions",
  "Scale text with objects": "Redimensionner le texte avec les objets",
  "Apply size": "Appliquer les dimensions",
  "Select objects with a resizable area.": "Sélectionnez des objets ayant une surface redimensionnable.",
  "Drag the corner to resize. Shift toggles proportions; Alt/Option bypasses snapping.": "Faites glisser le coin pour redimensionner. Maj inverse le maintien des proportions ; Alt/Option désactive temporairement l’alignement magnétique.",
  "Size adjusted to keep content readable. Review and apply again.": "Dimensions ajustées pour garder le contenu lisible. Vérifiez puis appliquez à nouveau.",
  "Toggle proportions while resizing": "Inverser le maintien des proportions pendant le redimensionnement",
  "Enter valid dimensions.": "Saisissez des dimensions valides.",
  "This size exceeds the board limits.": "Ces dimensions dépassent les limites du tableau.",
  "Keep text between 8 and 100 pixels.": "Gardez le texte entre 8 et 100 pixels.",
  "The selection changed. Select it again.": "La sélection a changé. Sélectionnez-la à nouveau.",
  "Snap to objects": "Alignement magnétique",
  "Snapping on. Hold Alt/Option to bypass.": "Alignement magnétique activé. Maintenez Alt/Option pour le désactiver temporairement.",
  "Snapping off.": "Alignement magnétique désactivé.",
  "Temporarily bypass snapping": "Désactiver temporairement l’alignement magnétique",
  "Cancel the current move or resize": "Annuler le déplacement ou le redimensionnement en cours",
  "Create frame around selection": "Créer un cadre autour de la sélection",
  "Move into frame": "Placer dans un cadre",
  "No frame": "Aucun cadre",
  "Align left": "Aligner à gauche",
  "Align top": "Aligner en haut",
  "Align right": "Aligner à droite",
  "Align bottom": "Aligner en bas",
  "Center vertically": "Centrer verticalement",
  "Distribute horizontally": "Répartir horizontalement",
  "Distribute vertically": "Répartir verticalement",
  "Send to back": "Mettre à l’arrière-plan",
  "Bring forward": "Avancer d’un plan",
  "Send backward": "Reculer d’un plan",
  Alignment: "Alignement",
  Spacing: "Espacement",
  "Layer order": "Ordre des plans",
  "Group and organize": "Grouper et organiser",
  "Select at least three objects or groups to distribute evenly.": "Sélectionnez au moins trois objets ou groupes pour les répartir uniformément.",
  "Send backward / bring forward": "Reculer / avancer d’un plan",
  "Send to back / bring to front": "Mettre à l’arrière-plan / au premier plan",
  "Center horizontally": "Centrer horizontalement",
  "Save as reusable content": "Enregistrer comme contenu réutilisable",
  "Frames and navigation": "Cadres et navigation",
  "Add a frame to organize content and create presentation slides.": "Ajoutez un cadre pour organiser le contenu et créer des diapositives.",
  "Go to frame": "Aller au cadre",
  "Move frame earlier": "Avancer le cadre",
  "Move frame later": "Reculer le cadre",
  "Frames can be reordered once the facilitator shows every frame.": "Les cadres pourront être réordonnés quand l’animateur affichera tous les cadres.",
  Section: "Section",
  Presentation: "Présentation",
  Present: "Présenter",
  "Present board": "Présenter le tableau",
  "Start presentation": "Démarrer la présentation",
  "Choose frames in presentation order.": "Choisissez les cadres dans l’ordre de présentation.",
  "Present selection": "Présenter la sélection",
  "Previous slide": "Diapositive précédente",
  "Next slide": "Diapositive suivante",
  "Exit presentation": "Quitter la présentation",
  Fullscreen: "Plein écran",
  "Selected content": "Contenu sélectionné",
  "Entire board": "Tableau entier",
  "Export scope": "Zone à exporter",
  "Selected objects or region": "Objets ou région sélectionnés",
  "Defined frames": "Cadres définis",
  "Export format": "Format d’exportation",
  Export: "Exporter",
  "Select objects or draw a region first.": "Sélectionnez des objets ou dessinez une région.",
  "Add a frame before exporting sections.": "Ajoutez un cadre avant d’exporter des sections.",
  "PDFs include a board overview and readable detail pages for large areas. Images export one region at a time.": "Les PDF comprennent une vue d’ensemble et des pages de détail lisibles pour les grandes zones. Les images exportent une région à la fois.",
  "Select export region": "Sélectionner une région à exporter",
  "Region selected. Open Export to use it.": "Région sélectionnée. Ouvrez Exporter pour l’utiliser.",
  "Clear region": "Effacer la région",
  "Version history": "Historique des versions",
  "Create checkpoint": "Créer un point de restauration",
  "Checkpoint name": "Nom du point de restauration",
  Checkpoint: "Point de restauration",
  "Restore version": "Restaurer cette version",
  "Before restoration": "Avant la restauration",
  "Board edit": "Modification du tableau",
  "Before deletion": "Avant la suppression",
  "No saved versions yet.": "Aucune version enregistrée pour le moment.",
  "Up to 30 recent versions are kept on this device, subject to a 50 MB limit. Restoring preserves the current version first.": "Jusqu’à 30 versions récentes sont conservées sur cet appareil, dans une limite de 50 Mo. La version actuelle est conservée avant toute restauration.",
  "Version restored.": "Version restaurée.",
  "Checkpoint saved.": "Point de restauration enregistré.",
  "Could not save the checkpoint. Export a backup.": "Impossible d’enregistrer le point de restauration. Exportez une sauvegarde.",
  "Could not save a recovery version. Export a backup.": "Impossible d’enregistrer une version de récupération. Exportez une sauvegarde.",
  "Template library": "Bibliothèque de modèles",
  "Browse all templates": "Parcourir tous les modèles",
  "Search templates": "Rechercher des modèles",
  "All categories": "Toutes les catégories",
  "Use template": "Utiliser ce modèle",
  "Insert into board": "Insérer dans le tableau",
  "My reusable content": "Mon contenu réutilisable",
  "No reusable content yet. Select objects on a board to save your own.": "Aucun contenu réutilisable. Sélectionnez des objets dans un tableau pour créer le vôtre.",
  "Reusable content saved.": "Contenu réutilisable enregistré.",
  "Could not save this content on this device.": "Impossible d’enregistrer ce contenu sur cet appareil.",
  "Delete template": "Supprimer le modèle",
  "Confirm delete": "Confirmer la suppression",
  "Use arrow keys to navigate slides. Press Escape to exit.": "Utilisez les touches fléchées pour naviguer. Appuyez sur Échap pour quitter.",
  Objects: "Objets",
  "Search objects": "Rechercher des objets",
  "Select an object to move it with the arrow keys. Press Enter to edit.": "Sélectionnez un objet, déplacez-le avec les flèches, puis appuyez sur Entrée pour le modifier.",
  "Your board is empty. Add a note or shape to get started.": "Votre tableau est vide. Ajoutez une note ou une forme.",
  "Canvas objects": "Objets du tableau",
  "Whiteboard canvas. Use Board objects to select and edit objects with the keyboard.": "Tableau blanc. Utilisez Objets du tableau pour sélectionner et modifier les objets au clavier.",
  "Undo (Ctrl/Cmd Z)": "Annuler (Ctrl/Cmd Z)",
  "Redo (Ctrl/Cmd Shift Z)": "Rétablir (Ctrl/Cmd Maj Z)",
  "A few ways to find your flow": "Quelques conseils pour bien démarrer",
  "Choose a tool, then click the canvas. Double-click an object to edit its text. Drag a corner to resize.": "Choisissez un outil, puis cliquez sur le tableau. Double-cliquez sur un objet pour modifier son texte. Faites glisser un coin pour le redimensionner.",
  "Select / pan": "Sélectionner / naviguer",
  "Sticky note / text": "Note adhésive / texte",
  "Rectangle / ellipse": "Rectangle / ellipse",
  "Arrow / draw / frame": "Flèche / dessin / cadre",
  "Move around the canvas": "Naviguer dans le tableau",
  "Zoom toward the pointer": "Zoomer vers le pointeur",
  "Select multiple objects": "Sélectionner plusieurs objets",
  "Move selected objects": "Déplacer les objets sélectionnés",
  "Edit the focused object": "Modifier l’objet actif",
  Undo: "Annuler",
  Redo: "Rétablir",
  "Delete selection": "Supprimer la sélection",
  "Keyboard-only? Use Board objects to select an object. Tool shortcuts add objects in the center of your view.": "Au clavier : utilisez Objets du tableau pour sélectionner un objet. Les raccourcis ajoutent les objets au centre de la vue.",
  "Drag to move this object. Use the corner handle to resize images.": "Faites glisser cet objet pour le déplacer. Utilisez la poignée d’angle pour redimensionner les images.",
  "Choose a file smaller than 20 MB.": "Choisissez un fichier de moins de 20 Mo.",
  "Choose an image smaller than 5 MB.": "Choisissez une image de moins de 5 Mo.",
  "Choose a PNG, JPEG, or WebP image.": "Choisissez une image PNG, JPEG ou WebP.",
  "Could not open image.": "Impossible d’ouvrir l’image.",
  "Could not import this file.": "Impossible d’importer ce fichier.",
  "Could not open cloud board.": "Impossible d’ouvrir le tableau dans le nuage.",
  "Puter could not load. Check your connection and try again.": "Puter n’a pas pu être chargé. Vérifiez votre connexion et réessayez.",
  "Could not connect to Puter.": "Connexion à Puter impossible.",
  "Could not connect. Please try again.": "Connexion impossible. Veuillez réessayer.",
  "Export failed. Please try again.": "L’exportation a échoué. Veuillez réessayer.",
  "This is not a supported Whiteboard file.": "Ce fichier Whiteboard n’est pas pris en charge.",
  "Your browser storage is unavailable.": "Le stockage de votre navigateur est indisponible.",
  "Enable site storage and reload to start creating safely.": "Activez le stockage du site et rechargez la page pour commencer.",
  Reload: "Recharger",
  Close: "Fermer",
  Create: "Créer",
  Cancel: "Annuler",
  Save: "Enregistrer",
  "Select objects first.": "Sélectionnez d’abord des objets.",
  "Select one object first.": "Sélectionnez d’abord un seul objet.",
  "Trash is empty.": "La corbeille est vide.",
  "Deleted boards can be restored here.": "Vous pouvez restaurer les tableaux supprimés ici.",
  "Board moved to Trash.": "Tableau déplacé dans la corbeille.",
  "Board restored.": "Tableau restauré.",
  "Reduce the selection to one region for image export.": "Choisissez une seule région pour exporter une image.",
  "Choose at least one frame.": "Choisissez au moins un cadre.",
  "No templates found.": "Aucun modèle trouvé.",
  "No matching objects.": "Aucun objet correspondant.",
  "Remove from frame": "Retirer du cadre",
  "Board edit saved": "Modification enregistrée",
  "action|Open": "Ouvrir",
  "notification|Reply": "Réponse",
  "results|Top": "Premiers",
  "Invite people to edit, comment on, or view this board. Invitations expire after seven days.": "Invitez des personnes à modifier, commenter ou consulter ce tableau. Les invitations expirent après sept jours.",
  "Your organization has turned off Miro imports.": "Votre organisation a désactivé les importations depuis Miro.",
  Planning: "Planification",
  "This export is too large. Export fewer frames at a time.": "Cette exportation est trop volumineuse. Exportez moins de cadres à la fois.",
  "This feature could not load. Check your connection and try again.": "Cette fonction n’a pas pu se charger. Vérifiez votre connexion et réessayez."
}, Ft = {
  __proto__: null,
  note: "note adhésive",
  text: "texte",
  rect: "rectangle",
  ellipse: "ellipse",
  arrow: "flèche",
  pen: "dessin",
  frame: "cadre",
  image: "image",
  table: "tableau de données",
  link: "lien",
  file: "pièce jointe",
  embed: "intégration"
};
function N(e, t) {
  if (Me !== "fr" || typeof e != "string") return e;
  if (Je[e]) return Je[e];
  let n;
  return (n = e.match(
    /^(Select|Pan|Sticky note|Text|Rectangle|Ellipse|Arrow|Draw|Frame) \((\w)\)$/
  )) ? `${Je[n[1]]} (${n[2]})` : (n = e.match(/^Edit (.+)$/)) && Ft[n[1]] ? `Modifier : ${Ft[n[1]]}` : (n = e.match(/^(\d+) results?$/)) ? `${n[1]} résultat(s)` : (n = e.match(/^(\d+) selected$/)) ? `${n[1]} sélectionné(s)` : (n = e.match(
    /^(All boards|Favorites|Your boards|Favorite boards) (\d+)$/
  )) ? `${Je[n[1]]} ${n[2]}` : (n = e.match(/^(Open|Favorite|Options for) (.+)$/)) ? `${{ Open: "Ouvrir", Favorite: "Favori :", "Options for": "Options pour" }[n[1]]} ${n[2]}` : (n = e.match(/^(\d+) objects/)) ? e.replace(`${n[1]} objects`, `${n[1]} objets`) : e;
}
const Bt = /* @__PURE__ */ new WeakMap(), Wt = /* @__PURE__ */ new WeakMap();
function An(e = document.body) {
  document.documentElement.lang !== Me && (document.documentElement.lang = Me);
  const t = "[data-user-content],textarea,script,style,.cloud-file,.board-info h3,#board-outline";
  if (e.closest?.(t)) return;
  const n = document.createTreeWalker(
    e,
    NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT,
    (a) => a.nodeType === 3 ? NodeFilter.FILTER_ACCEPT : a.matches(t) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_SKIP
  ), r = [];
  for (; n.nextNode(); ) r.push(n.currentNode);
  for (const a of r) {
    const o = Bt.get(a), s = o && o.rendered === a.textContent ? o.original : a.textContent, c = s.trim(), l = s.replace(c, () => N(c));
    l !== a.textContent && (a.textContent = l), Bt.set(a, { original: s, rendered: l });
  }
  e.querySelectorAll("[aria-label],[title],[placeholder]").forEach((a) => {
    const o = Wt.get(a) || {}, s = a.hasAttribute("title") && !!a.closest("[data-user-content]");
    for (const c of ["aria-label", "title", "placeholder"])
      if (a.hasAttribute(c) && !(s && c === "title")) {
        const l = a.getAttribute(c), d = o[c], C = d?.rendered === l ? d.original : l, f = N(C);
        f !== l && a.setAttribute(c, f), o[c] = { original: C, rendered: f };
      }
    Wt.set(a, o);
  });
}
function Ie(e, t = 0, n = e.value.length) {
  n > t && /[\uD800-\uDBFF]/.test(e.value[n - 1] || "") && /[\uDC00-\uDFFF]/.test(e.value[n] || "") && n--;
  const r = e.value.slice(t, n), a = [];
  for (const s of nt(e.textRuns, t, n)) {
    const c = ee(s.style.lang);
    c && ie(a, s.start, s.end, { lang: c });
  }
  const o = ee(
    e.fieldLanguage ? e.fieldLanguage() : e.lang
  );
  return {
    text: r,
    ...o ? { lang: o } : {},
    ...a.length ? { textRuns: a } : {}
  };
}
function jn(e, t, n) {
  const r = e.ownerDocument, a = e.id, o = Cn(r, t, {
    plainTextOnly: !0,
    ...n
  });
  o.id = a, o.defaultValue = o.value, o.className = "authored-label-field fac-authored-input", o.tabIndex = 0, o.setAttribute("data-user-content", ""), o.setAttribute("aria-labelledby", `${a}-label`), n.required && o.setAttribute("aria-required", "true");
  const s = r.createElement("div");
  e.replaceWith(s), s.append(o), s.insertAdjacentHTML(
    "beforeend",
    `<button id="${a}-language-options" class="text-btn" type="button" aria-labelledby="${a}-language-action ${a}-label" aria-expanded="false" aria-controls="${a}-language-controls"><span id="${a}-language-action">${N("Content language")}</span></button><div id="${a}-language-controls" hidden></div>`
  );
  const c = s.querySelector("button"), l = s.lastElementChild, d = n.languageButton || c;
  n.languageButton && (c.remove(), d.setAttribute("aria-controls", l.id), d.setAttribute("aria-expanded", "false")), o.languageControls = l;
  let C = ee(t.lang), f = ee(n.inheritedLanguage), S;
  o.fieldLanguage = () => C, o.inheritLanguage = (p) => {
    f = ee(p), j(C);
  };
  function j(p) {
    C = ee(p), C || f ? o.lang = C || f : o.removeAttribute("lang"), o.setBaseStyle({ lang: C || f });
  }
  j(C), o.addEventListener("input", () => o.removeAttribute("aria-invalid")), n.multiline === !1 && o.addEventListener("keydown", (p) => {
    p.key === "Enter" && !p.isComposing && p.keyCode !== 229 && !p.shiftKey && !p.ctrlKey && !p.metaKey && !p.altKey && (p.preventDefault(), o.closest("form")?.requestSubmit());
  });
  const D = JSON.stringify(Ie(o));
  function b(p = !1) {
    S = void 0, l.hidden = !0, l.replaceChildren(), d.setAttribute("aria-expanded", "false"), p && d.focus();
  }
  function h(p) {
    S = p || {
      start: o.selectionStart,
      end: o.selectionEnd,
      direction: o.selectionDirection,
      text: o.value
    };
    const x = S.end > S.start;
    l.innerHTML = `<label class="field">${N("Apply to")}<select id="${a}-language-scope">${x ? `<option value="text">${N("Selected text")}</option>` : ""}<option value="field">${N("Whole field")}</option></select></label><label class="field">${N("Language tag")}<input id="${a}-language-tag" maxlength="64" autocomplete="off" spellcheck="false" placeholder="fr-CA" aria-describedby="${a}-language-help ${a}-language-error"></label><p class="dialog-copy" id="${a}-language-help">${N("Enter a language tag, such as en, fr-CA, or es. Leave empty to inherit the surrounding language.")}</p><p id="${a}-language-error" role="alert" hidden></p><div class="dialog-footer"><button type="button" class="text-btn" id="${a}-language-cancel">${N("Cancel")}</button><button type="button" class="secondary" id="${a}-language-save">${N("Apply language")}</button></div>`;
    const M = l.querySelector("select"), k = l.querySelector("input"), P = l.querySelector('[role="alert"]'), R = () => {
      const L = M.value === "text" ? o.rangeStyle("lang") : C;
      k.value = L && L !== "mixed" ? L : "";
    };
    M.onchange = R, R(), S.scope && (M.value = S.scope), S.tag !== void 0 && (k.value = S.tag), S.error && (P.hidden = !1, P.textContent = S.error), l.hidden = !1, d.setAttribute("aria-expanded", "true"), l.querySelector(`#${a}-language-cancel`).onclick = () => b(!0), l.querySelector(`#${a}-language-save`).onclick = () => {
      const L = k.value.trim(), G = L ? ee(L) : null;
      let H;
      if (L && !G)
        H = N("Enter a valid language tag, such as en or fr-CA.");
      else if (M.value === "text" && o.value !== S.text)
        H = N("The selected text changed. Select it again.");
      else if (M.value === "text")
        try {
          bt(
            o.value,
            ct(
              o.value,
              o.textRuns,
              S.start,
              S.end,
              { lang: G }
            )
          );
        } catch {
          H = N("Select complete characters to set their language.");
        }
      if (H) {
        P.hidden = !1, P.textContent = H, k.setAttribute("aria-invalid", "true"), k.focus();
        return;
      }
      M.value === "text" ? (o.setSelectionRange(S.start, S.end, S.direction), o.format("lang", G)) : j(G), b(!0);
    }, k.oninput = () => {
      P.hidden = !0, k.removeAttribute("aria-invalid");
    }, l.onkeydown = (L) => {
      L.isComposing || L.keyCode === 229 || (L.key === "Escape" ? (L.preventDefault(), L.stopPropagation(), b(!0)) : L.key === "Enter" && (L.preventDefault(), L.stopPropagation(), l.querySelector(`#${a}-language-save`).click()));
    };
  }
  return d.onclick = () => {
    l.hidden ? (h(), l.querySelector("input").focus()) : b(!0);
  }, o.languageState = () => ({
    content: Ie(o),
    edited: JSON.stringify(Ie(o)) !== D,
    selection: {
      start: o.selectionStart,
      end: o.selectionEnd,
      direction: o.selectionDirection
    },
    ...S ? {
      popup: {
        ...S,
        scope: l.querySelector("select").value,
        tag: l.querySelector("input").value,
        error: l.querySelector('[role="alert"]').hidden ? "" : l.querySelector('[role="alert"]').textContent
      }
    } : {}
  }), o.restoreLanguageState = (p) => {
    p.edited && (j(p.content.lang), o.setRichText(p.content.text, p.content.textRuns || [])), o.setSelectionRange(
      p.selection.start,
      p.selection.end,
      p.selection.direction
    ), p.popup && h(p.popup);
  }, o;
}
const Yt = (e) => String(e).replace(
  /[&<>"']/g,
  (t) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[t]
);
function Xe(e) {
  const t = ee(e);
  return t ? ` lang="${Yt(t)}"` : "";
}
function Zt(e, t = e.text || "", n = 0, r = !1) {
  const a = Le(
    t,
    nt(e.textRuns, n, n + t.length)
  );
  return `<span data-user-content${Xe(e.lang)}>` + a.map(
    (o) => `<span${Xe(o.style.lang)}>${Yt(r ? o.text.replace(/\s+/g, " ") : o.text)}</span>`
  ).join("") + "</span>";
}
const En = [
  { id: "dm-sans", name: "DM Sans", fallback: "system-ui, sans-serif" },
  { id: "noto-sans", name: "Noto Sans", fallback: "system-ui, sans-serif" },
  { id: "eb-garamond", name: "EB Garamond", fallback: "Georgia, serif" },
  { id: "roboto-mono", name: "Roboto Mono", fallback: "monospace" },
  { id: "caveat", name: "Caveat", fallback: "cursive" }
], mt = new Map(En.map((e) => [e.id, e])), Tn = (e) => mt.has(e), vt = (e) => Tn(e.fontFamily) ? e.fontFamily : "dm-sans";
function yt(e = "dm-sans") {
  const t = mt.get(e) || mt.get("dm-sans");
  return `"${t.name}", ${t.fallback}`;
}
const Ce = {
  column: { key: "columnWidths", dimension: "w", minimum: 40 },
  row: { key: "rowHeights", dimension: "h", minimum: 24 }
}, Rn = (e, t) => t === "column" ? e.cells[0].length : e.cells.length, Ct = (e) => e.reduce((t, n) => t + n, 0);
function oe(e, t) {
  const { key: n, dimension: r } = Ce[t], a = Rn(e, t), o = e[n];
  if (!o || o.length !== a)
    return Array(a).fill(e[r] / a);
  const s = e[r] / Ct(o);
  return o.map((c) => c * s);
}
function at(e) {
  const t = oe(e, "column"), n = oe(e, "row"), r = (a, o) => {
    const s = [0];
    for (const c of a) s.push(s.at(-1) + c);
    return s[s.length - 1] = o, s;
  };
  return { columns: t, rows: n, x: r(t, e.w), y: r(n, e.h) };
}
function Ut(e, t, n, r) {
  const { key: a, dimension: o, minimum: s } = Ce[t], c = oe(e, t);
  if (!n.length || n.some((d) => !Number.isInteger(d) || d < 0 || d >= c.length) || !Number.isFinite(r) || r < s)
    throw Error("Enter a valid row height or column width.");
  for (const d of n) c[d] = r;
  const l = Ct(c);
  if (l > 1e6) throw Error("This size exceeds the board limits.");
  return { [a]: c, [o]: l };
}
new TextEncoder();
const Pn = [
  ["thumbs", "👍", "Thumbs up"],
  ["heart", "❤️", "Heart"],
  ["laugh", "😂", "Laugh"],
  ["celebrate", "🎉", "Celebrate"],
  ["idea", "💡", "Idea"],
  ["question", "❓", "Question"],
  ["plus", "➕", "Plus one"],
  ["eyes", "👀", "Eyes"]
];
new Set(Pn.map((e) => e[0]));
function Dn(e, t, n) {
  const r = [];
  for (const a of t.split(/[\n\u2028]/)) {
    let o = "";
    for (const s of a.split(" ")) {
      const c = o ? `${o} ${s}` : s;
      if (o && e.measureText(c).width > n && (r.push(o), o = ""), e.measureText(s).width > n && s.length > 1) {
        o && (r.push(o), o = "");
        const l = Array.from(s);
        let d = 0;
        for (; d < l.length; ) {
          const C = l.length - d, f = (b) => e.measureText(l.slice(d, d + b).join("")).width <= n;
          let S = 1, j = 2;
          for (; j < C && f(j); )
            S = j, j *= 2;
          for (j = Math.min(j, C); S < j; ) {
            const b = Math.ceil((S + j) / 2);
            f(b) ? S = b : j = b - 1;
          }
          const D = l.slice(d, d + S).join("");
          d += S, d < l.length ? r.push(D) : o = D;
        }
      } else o = o ? `${o} ${s}` : s;
    }
    r.push(o);
  }
  return r;
}
const Re = [
  "#f6e7a4",
  "#d9e9d2",
  "#dce5f7",
  "#eadcf0",
  "#f3d6c8",
  "#ffffff"
], Qt = () => crypto.randomUUID();
function ye(e, t, n, r = {}) {
  return {
    id: Qt(),
    type: e,
    x: t,
    y: n,
    w: e === "text" ? 280 : 190,
    h: e === "text" ? 60 : 160,
    text: "",
    color: ["arrow", "pen"].includes(e) ? "#687169" : Re[0],
    ...e === "note" ? { autoFontSize: !0 } : {},
    ...r
  };
}
function Ln(e = "Untitled board", t = "blank") {
  const n = {
    version: 1,
    id: Qt(),
    title: e,
    updated: Date.now(),
    favorite: !1,
    items: []
  };
  if (t === "brainstorm" && (n.items = [
    ye("text", 80, 55, {
      text: "Room for a great idea",
      w: 680,
      h: 65,
      fontSize: 36
    }),
    ye("text", 80, 130, {
      text: "Start with a question. Follow your curiosity.",
      w: 650,
      fontSize: 18
    }),
    ...[
      "What if we…",
      "Something worth exploring",
      "A different perspective"
    ].map(
      (r, a) => ye("note", 80 + a * 245, 240, {
        text: r,
        color: Re[a],
        w: 210,
        h: 190
      })
    )
  ]), t === "kanban" && (n.items = ["To do", "In progress", "Done"].flatMap((r, a) => [
    ye("frame", 70 + a * 290, 60, {
      w: 270,
      h: 500,
      text: r,
      color: Re[a]
    }),
    ye("note", 90 + a * 290, 140, {
      text: [
        "Your next step",
        "Make a little progress",
        "Celebrate the small wins"
      ][a],
      w: 230,
      h: 160,
      color: Re[a]
    })
  ])), t === "mindmap") {
    const r = ye("rect", 340, 180, {
      text: "The big idea",
      color: Re[1],
      w: 220,
      h: 90,
      fontSize: 24,
      textAlign: "center",
      autoFontSize: !0,
      mindMap: { parent: null, direction: "right", auto: !0, line: "curved" }
    });
    n.items = [
      r,
      ...["Explore", "Connect", "Build on it"].map(
        (a, o) => ye("rect", 640, 78 + o * 104, {
          text: a,
          w: 200,
          h: 76,
          color: Re[o],
          fontSize: 20,
          textAlign: "center",
          autoFontSize: !0,
          order: o + 1,
          mindMap: {
            parent: r.id,
            direction: "right",
            auto: !0,
            line: "curved"
          }
        })
      )
    ];
  }
  return n;
}
const Xt = 1e6, We = "Paste up to 50 rows and 100 columns at a time.", et = "Tables support up to 20 rows, 12 columns, and 2,000 characters per cell.";
function en(e) {
  if (e.length > Xt)
    throw Error("Paste up to 1 million characters at a time.");
}
function tn(e) {
  const t = Math.max(...e.map((n) => n.length));
  if (e.length > 50 || t > 100) throw Error(We);
  return e.map(
    (n) => Array.from({ length: t }, (r, a) => n[a] ?? "")
  );
}
function In(e) {
  en(e), e = e.replace(/\r\n?/g, `
`);
  const t = [];
  let n = [], r = "", a = !1, o = !1;
  const s = () => {
    if (n.push(r), r = "", o = !1, n.length > 100) throw Error(We);
  };
  for (let c = 0; c < e.length; c++) {
    const l = e[c];
    if (a)
      l !== '"' ? r += l : e[c + 1] === '"' ? (r += '"', c++) : (a = !1, o = !0);
    else if (l === "	" || l === `
`) {
      if (s(), l === `
` && (t.push(n), n = [], t.length > 50))
        throw Error(We);
    } else if (l === '"' && r === "" && !o) a = !0;
    else {
      if (o)
        throw Error("Check the quotes in the pasted spreadsheet cells.");
      r += l;
    }
  }
  if (a) throw Error("Check the quotes in the pasted spreadsheet cells.");
  return (!e.endsWith(`
`) || n.length || r || o) && (s(), t.push(n)), tn(t.length ? t : [[""]]);
}
function qn(e) {
  const t = e.map(
    (n) => n.map(
      (r) => /[\t\n\r"]/.test(r) ? `"${r.replaceAll('"', '""')}"` : r
    ).join("	")
  ).join(`
`);
  return e.at(-1)?.length === 1 && e.at(-1)[0] === "" ? t + `
` : t;
}
function Nn(e) {
  const t = ee(e.closest("[lang]")?.getAttribute("lang")), n = [];
  let r = "";
  function a(s, c) {
    const l = r.length;
    r += s, c && c !== t && ie(n, l, r.length, { lang: c });
  }
  function o(s, c) {
    if (s.nodeType === 3) {
      a(s.textContent.replace(/\r\n?/g, `
`), c);
      return;
    }
    if (!(s.nodeType !== 1 || /^(SCRIPT|STYLE|TEMPLATE|IMG)$/.test(s.tagName))) {
      if (s.hasAttribute("lang") && (c = ee(s.getAttribute("lang"))), s.tagName === "BR") {
        a(`
`, c);
        return;
      }
      for (const l of s.childNodes) {
        const d = /^(P|DIV)$/.test(l.tagName);
        d && r && !r.endsWith(`
`) && a(`
`, c), o(l, c), d && l.nextSibling && !r.endsWith(`
`) && a(`
`, c);
      }
    }
  }
  return o(e, t), {
    text: r,
    ...t ? { lang: t } : {},
    ...n.length ? { textRuns: n } : {}
  };
}
function On(e, t = document) {
  const n = e.getData("text/html");
  if (/<table[\s>]/i.test(n)) {
    if (n.length > 4 * Xt)
      throw Error("Paste up to 1 million characters at a time.");
    const a = t.createElement("template");
    a.innerHTML = n;
    const o = a.content.querySelectorAll("table");
    if (o.length !== 1)
      throw Error("Paste one spreadsheet range at a time.");
    const s = o[0], c = [], l = {};
    if (s.rows.length > 50) throw Error(We);
    for (const [d, C] of Array.from(s.rows).entries()) {
      c[d] ||= [];
      let f = 0;
      for (const S of C.cells) {
        for (; c[d][f] !== void 0; ) f++;
        const j = S.rowSpan || s.rows.length - d, D = S.colSpan;
        if (d + j > 50 || f + D > 100) throw Error(We);
        const { text: b, ...h } = Nn(S);
        Object.keys(h).length && (l[`${d},${f}`] = h);
        for (let p = d; p < d + j; p++) {
          c[p] ||= [];
          for (let x = f; x < f + D; x++) {
            if (c[p][x] !== void 0)
              throw Error("Paste one spreadsheet range at a time.");
            c[p][x] = p === d && x === f ? b : "";
          }
        }
        f += D;
      }
    }
    if (c.length && c.some((d) => d.length)) {
      const d = tn(c);
      return en(d.flat().join("")), {
        cells: d,
        ...Object.keys(l).length ? { cellLanguages: l } : {}
      };
    }
  }
  const r = e.getData("text/plain");
  return r.includes("	") ? { cells: In(r) } : null;
}
const tt = (e) => e.length > 0 && e.length <= 20 && e.every(
  (t) => t.length <= 12 && t.every((n) => n.length <= 2e3)
);
function $n(e, t, n, r) {
  const a = Math.max(e.length, n + t.length), o = Math.max(e[0].length, r + t[0].length);
  if (a > 20 || o > 12 || !tt(t))
    throw Error(et);
  const s = Array.from(
    { length: a },
    (c, l) => Array.from({ length: o }, (d, C) => e[l]?.[C] ?? "")
  );
  return t.forEach(
    (c, l) => c.forEach((d, C) => {
      s[n + l][r + C] = d;
    })
  ), s;
}
function Fn(e, t) {
  const n = oe(e, "column"), r = e.fontSize || 15;
  return t.font = `400 ${r}px ${yt(vt(e))}`, e.cells.map(
    (a) => Math.max(
      24,
      ...a.map(
        (o, s) => 18 + Dn(t, o, Math.max(1, n[s] - 18)).length * r * 1.35
      )
    )
  );
}
function Bn(e, t, n, r) {
  const { key: a, dimension: o, minimum: s } = Ce[t], c = oe(e, t);
  if (t === "row") {
    const d = Fn(e, r);
    for (const C of n) c[C] = d[C];
  } else {
    r.font = `400 ${e.fontSize || 15}px ${yt(vt(e))}`;
    for (const d of n)
      c[d] = Math.max(
        s,
        ...e.cells.flatMap(
          (C) => C[d].split(`
`).map((f) => r.measureText(f).width + 18)
        )
      );
  }
  const l = Ct(c);
  if (l > 1e6) throw Error("This size exceeds the board limits.");
  return { [a]: c, [o]: l };
}
function Kt(e, t, n) {
  const r = at(e);
  if (t.x < e.x || t.y < e.y || t.x > e.x + e.w + n || t.y > e.y + e.h + n)
    return null;
  let a = null;
  for (const [o, s, c] of [
    ["column", r.x, t.x - e.x],
    ["row", r.y, t.y - e.y]
  ])
    for (let l = 1; l < s.length; l++) {
      const d = Math.abs(c - s[l]);
      d <= n && (!a || d < a.distance) && (a = { axis: o, index: l - 1, distance: d });
    }
  return a;
}
function Wn(e) {
  let t, n;
  const r = /* @__PURE__ */ new Map(), a = (b) => {
    const h = e.canvas().getBoundingClientRect(), p = e.state().view;
    return {
      x: (b.clientX - h.left - p.x) / p.z,
      y: (b.clientY - h.top - p.y) / p.z
    };
  };
  function o() {
    if (!n) return !1;
    const b = e.current(), h = e.state().view;
    return !!b && e.writable(b) && e.state().board === n.board && b.id === n.id && b.x === n.x && b.y === n.y && b.cells.length === n.rows && b.cells[0].length === n.cols && h.x === n.view.x && h.y === n.view.y && h.z === n.view.z && Math.abs(oe(b, n.axis)[n.index] - n.base) < 1e-8;
  }
  function s() {
    if (!o())
      return n = null, null;
    if (!n.changed) return null;
    const b = e.current();
    try {
      return {
        ...b,
        ...Ut(b, n.axis, [n.index], n.size)
      };
    } catch {
      return n = null, null;
    }
  }
  function c(b = !0) {
    const h = !!n;
    return n = null, h && b && e.draw(), h;
  }
  function l(b, h, p, x) {
    if (n) return !1;
    const M = e.current();
    if (!M || !e.writable(M) || x.button !== 0 || !e.finish()) return !1;
    const k = e.current();
    return n = {
      axis: b,
      index: h,
      pointerId: x.pointerId,
      id: k.id,
      board: e.state().board,
      x: k.x,
      y: k.y,
      rows: k.cells.length,
      cols: k.cells[0].length,
      base: oe(k, b)[h],
      point: p,
      view: { ...e.state().view },
      changed: !1
    }, x.preventDefault(), e.draw(), !0;
  }
  function d(b) {
    if (!n) return !1;
    if (!o())
      return c(), !0;
    const h = n.axis, p = h === "column" ? "x" : "y", x = b[p] - n.point[p];
    if (Math.abs(x) * n.view.z < 3 && !n.changed) return !0;
    const M = e.current(), R = 1e6 - oe(M, h).reduce(
      (L, G, H) => H === n.index ? L : L + G,
      0
    ) - 1e-8;
    return R < Ce[h].minimum ? (c(), !0) : (n.size = Math.max(
      Ce[h].minimum,
      Math.min(R, n.base + x)
    ), n.changed = Math.abs(n.size - n.base) > 1e-8, e.draw(), !0);
  }
  function C(b = !1) {
    if (!n) return !1;
    const h = n, p = !b && o() && h.changed;
    return n = null, p ? f(h.axis, [h.index], h.size) : e.draw(), !0;
  }
  function f(b, h, p) {
    if (!e.finish()) return;
    const x = e.current();
    if (!(!x || !e.writable(x))) {
      try {
        const M = oe(x, b), k = p === "fit" ? Bn(x, b, h, e.canvas().getContext("2d")) : Ut(
          x,
          b,
          h,
          p === "equal" ? h.reduce((P, R) => P + M[R], 0) / h.length : p
        );
        if (oe({ ...x, ...k }, b).every(
          (P, R) => Math.abs(P - M[R]) < 1e-8
        ))
          return;
        e.commit(x, k);
      } catch (M) {
        e.error(M.message);
      }
      e.draw();
    }
  }
  function S(b) {
    const h = e.range();
    return Array.from(
      { length: b === "column" ? h.cols : h.rows },
      (p, x) => x + (b === "column" ? h.c : h.r)
    );
  }
  function j(b) {
    t = b, r.clear(), n = null;
    const h = t.ownerDocument.createElement("div");
    h.className = "table-size-controls", h.innerHTML = ["column", "row"].map(
      (p) => `<label>${N(p === "column" ? "Column width" : "Row height")}<input type="number" id="table-${p}-size" min="${Ce[p].minimum}" max="1000000" step="1" placeholder="${N("Mixed")}" aria-label="${N(p === "column" ? "Column width" : "Row height")}"></label><button type="button" class="text-btn" data-table-size="${p}:fit">${N(p === "column" ? "Fit columns to text" : "Fit rows to text")}</button><button type="button" class="text-btn" data-table-size="${p}:equal">${N(p === "column" ? "Equal column widths" : "Equal row heights")}</button>`
    ).join(""), t.querySelector(".table-cell-tools").append(h);
    for (const p of ["column", "row"]) {
      const x = h.querySelector(`#table-${p}-size`);
      x.onchange = () => {
        f(p, S(p), x.valueAsNumber), D();
      }, x.onkeydown = (k) => {
        k.key === "Enter" && (k.preventDefault(), k.stopPropagation(), f(p, S(p), x.valueAsNumber));
      };
      const M = t.ownerDocument.createElement("button");
      M.type = "button", M.className = `table-size-handle table-size-${p}`, M.dataset.tableResize = p, M.setAttribute("role", "separator"), M.setAttribute(
        "aria-orientation",
        p === "column" ? "vertical" : "horizontal"
      ), M.innerHTML = `<span aria-hidden="true">${p === "column" ? "↔" : "↕"}</span>`, M.addEventListener("pointerdown", (k) => {
        if (k.stopPropagation(), l(p, S(p).at(-1), a(k), k)) {
          M.focus({ preventScroll: !0 });
          try {
            M.setPointerCapture?.(k.pointerId);
          } catch {
          }
        }
      }), M.addEventListener("pointermove", (k) => {
        n?.pointerId === k.pointerId && d(a(k));
      }), M.addEventListener("pointerup", (k) => {
        n?.pointerId === k.pointerId && (d(a(k)), C());
      });
      for (const k of ["pointercancel", "lostpointercapture"])
        M.addEventListener(k, (P) => {
          n?.pointerId === P.pointerId && c();
        });
      M.ondblclick = (k) => {
        k.preventDefault(), f(p, [S(p).at(-1)], "fit");
      }, M.onkeydown = (k) => {
        k.key === "Escape" && (k.preventDefault(), k.stopPropagation(), c(), e.canvas().focus());
        const P = {
          ArrowRight: p === "column" ? 1 : 0,
          ArrowLeft: p === "column" ? -1 : 0,
          ArrowDown: p === "row" ? 1 : 0,
          ArrowUp: p === "row" ? -1 : 0
        }[k.key];
        if (P && !k.ctrlKey && !k.metaKey && !k.altKey) {
          k.preventDefault(), k.stopPropagation();
          const R = S(p).at(-1);
          f(
            p,
            [R],
            Math.max(
              Ce[p].minimum,
              oe(e.current(), p)[R] + P * (k.shiftKey ? 10 : 1)
            )
          );
        }
      }, t.append(M), r.set(p, M);
    }
    for (const p of h.querySelectorAll("button"))
      p.onclick = () => {
        const [x, M] = p.dataset.tableSize.split(":");
        f(x, S(x), M);
      };
  }
  function D() {
    if (!t?.isConnected || !e.current()) return;
    const b = s() || e.current(), h = e.state().view, p = e.canvas().getBoundingClientRect(), x = at(b), M = e.writable(e.current());
    for (const k of ["column", "row"]) {
      const P = S(k), R = oe(b, k), L = P.at(-1), G = t.querySelector(`#table-${k}-size`), H = r.get(k);
      t.ownerDocument.activeElement !== G && (G.value = P.every(
        (fe) => Math.abs(R[fe] - R[P[0]]) < 1e-8
      ) ? String(Math.round(R[P[0]] * 100) / 100) : ""), G.disabled = !M, t.querySelectorAll(`[data-table-size^="${k}:"]`).forEach((fe) => fe.disabled = !M);
      const te = h.x + b.x * h.z + (k === "column" ? x.x[L + 1] * h.z : -24), se = h.y + b.y * h.z + (k === "row" ? x.y[L + 1] * h.z : -24);
      H.hidden = !M || e.editing() || !!(p.width && (te < 22 || se < 22 || te > p.width - 22 || se > p.height - 22)), H.style.left = `${te}px`, H.style.top = `${se}px`, H.setAttribute(
        "aria-label",
        `${N(k === "column" ? "Resize column" : "Resize row")} ${L + 1}`
      ), H.setAttribute("aria-valuemin", String(Ce[k].minimum)), H.setAttribute("aria-valuemax", "1000000"), H.setAttribute("aria-valuenow", String(Math.round(R[L])));
    }
  }
  return {
    bind: j,
    render: D,
    preview: s,
    cancel: c,
    move: d,
    end: C,
    cursor(b) {
      const h = e.current();
      if (!h || e.editing() || !e.writable(h)) return "default";
      const p = Kt(h, b, 6 / e.state().view.z);
      return p ? p.axis === "column" ? "col-resize" : "row-resize" : "default";
    },
    down(b, h) {
      if (e.editing()) return !1;
      const p = e.current(), x = p && Kt(p, h, 6 / e.state().view.z);
      return x ? l(x.axis, x.index, h, b) : !1;
    },
    keydown(b) {
      return n && b.key === "Escape" ? (b.preventDefault(), c(), !0) : !1;
    }
  };
}
function Vt(e, t, n = !1) {
  if (e?.type !== "table" || !e.cells?.length || e.w <= 0 || e.h <= 0)
    return null;
  const r = at(e), a = (c, l) => l < 0 ? -1 : c.findIndex((d) => d > l) - 1;
  let o = a(r.y, t.y - e.y), s = a(r.x, t.x - e.x);
  return t.y >= e.y + e.h && (o = e.cells.length), t.x >= e.x + e.w && (s = e.cells[0].length), !n && (o < 0 || s < 0 || o >= e.cells.length || s >= e.cells[0].length) ? null : {
    r: Math.max(0, Math.min(e.cells.length - 1, o)),
    c: Math.max(0, Math.min(e.cells[0].length - 1, s))
  };
}
function Un(e, t = e) {
  return {
    r: Math.min(e.r, t.r),
    c: Math.min(e.c, t.c),
    rows: Math.abs(t.r - e.r) + 1,
    cols: Math.abs(t.c - e.c) + 1
  };
}
function Oe(e, t) {
  const { x: n, y: r } = at(e), a = Math.max(0, Math.min(t.c, n.length - 2)), o = Math.max(0, Math.min(t.r, r.length - 2));
  return {
    x: e.x + n[a],
    y: e.y + r[o],
    w: n[Math.min(n.length - 1, a + (t.cols || 1))] - n[a],
    h: r[Math.min(r.length - 1, o + (t.rows || 1))] - r[o]
  };
}
function Kn(e, t, n = { cells: e }) {
  const r = e.slice(t.r, t.r + t.rows).map((a) => a.slice(t.c, t.c + t.cols));
  return {
    "text/plain": qn(r),
    "text/html": `<table${Xe(n.lang)}><tbody>${r.map((a, o) => `<tr>${a.map((s, c) => `<td${Xe(Fe(n, t.r + o, t.c + c, !1).lang)}>${Zt(Fe(n, t.r + o, t.c + c, !1)).replaceAll(`
`, "<br>")}</td>`).join("")}</tr>`).join("")}</tbody></table>`
  };
}
function nn(e, t, n = "") {
  return e.map(
    (r, a) => r.map(
      (o, s) => a >= t.r && a < t.r + t.rows && s >= t.c && s < t.c + t.cols ? n : o
    )
  );
}
function Vn(e, t, n) {
  if (!tt(t)) throw Error(et);
  return t.length === 1 && t[0].length === 1 ? nn(e, n, t[0][0]) : $n(e, t, n.r, n.c);
}
function Hn(e) {
  let t = null, n, r, a, o, s, c;
  const l = /* @__PURE__ */ new Map(), d = Wn({
    ...e,
    current: () => C(),
    range: () => f(),
    editing: () => !!r,
    finish: () => h(),
    commit: (u, v) => e.resize?.(u, v),
    error: (u) => D(u)
  }), C = () => t && e.state().board === t.board && t.board.items.find((u) => u.id === t.id && u.type === "table"), f = () => Un(t.anchor, t.end), S = (u = t.end) => `${t.board.id}/${t.id}/${u.r}/${u.c}`;
  function j() {
    if (!(!r || !a || JSON.stringify(Ie(r)) === JSON.stringify(a.original)))
      for (l.delete(a.key), l.set(a.key, { ...a, content: Ie(r) }); l.size > 100; ) l.delete(l.keys().next().value);
  }
  function D(u) {
    const v = n?.querySelector("#table-cell-error");
    v ? (v.textContent = N(u), v.hidden = !1) : e.toast(u);
  }
  function b(u) {
    return u && e.writable(u) && u.cells.length === a.rows && u.cells[0].length === a.cols && u.cells[a.r]?.[a.c] === a.value && JSON.stringify(Fe(u, a.r, a.c, !1)) === JSON.stringify(a.original);
  }
  function h(u = !0) {
    if (!r) return !0;
    const v = C(), z = Ie(r), y = z.text, T = JSON.stringify(z) !== JSON.stringify(a.original);
    if (u && T && !b(v))
      return j(), D(
        "This cell changed or is protected. Your draft is kept; copy it or use the latest value."
      ), !1;
    const O = a, J = r, X = document.activeElement === J;
    l.delete(O.key);
    const K = r.parentElement, Z = r.languageControls, V = n.querySelector("#table-cell-language"), le = V.onclick;
    if (K.remove(), Z.remove(), p(), r = null, a = null, n?.querySelector("#table-cell-reset")?.setAttribute("hidden", ""), u && T) {
      const he = v.cells.map((Se) => [...Se]);
      if (he[O.r][O.c] = y, !M(he, void 0, {
        [`${O.r},${O.c}`]: Ze(y, {
          lang: z.lang,
          textRuns: z.textRuns
        })
      }))
        return r = J, a = O, n.append(K), n.querySelector(".table-cell-tools").append(Z), V.onclick = le, V.setAttribute("aria-controls", Z.id), V.setAttribute("aria-expanded", String(!Z.hidden)), j(), Q(), X && document.activeElement === document.body && r.focus({ preventScroll: !0 }), !1;
    }
    return J.destroy(), !0;
  }
  function p() {
    const u = n?.querySelector("#table-cell-language");
    u && (u.removeAttribute("aria-controls"), u.setAttribute("aria-expanded", "false"), u.onclick = () => {
      R(), r && u.onclick();
    });
  }
  function x(u = !0) {
    t && (d.cancel(!1), h(u) || (e.toast("Cell draft kept. Reopen the cell to review it."), r?.languageControls.remove(), r?.destroy(), r?.parentElement.remove(), r = null, a = null), n?.remove(), n = null, t = null, o = null, s = null, c = null);
  }
  function M(u, v, z) {
    const y = C();
    if (!y || !e.writable(y))
      return D("This table is protected."), !1;
    if (!tt(u) || !u.every((O) => O.length === u[0].length))
      return D(et), !1;
    const T = Jt(y, u, v, z);
    if (JSON.stringify(u) === JSON.stringify(y.cells) && JSON.stringify(T.cellLanguages) === JSON.stringify(y.cellLanguages))
      return !0;
    try {
      e.change(y, u, v, z);
    } catch (O) {
      return D(O.message), !1;
    }
    return !0;
  }
  function k(u, v = { r: 0, c: 0 }, z = !1) {
    if (x(), e.prepare(), !u || u.type !== "table") return;
    t = {
      board: e.state().board,
      id: u.id,
      anchor: { ...v },
      end: { ...v }
    }, n = document.createElement("div"), n.id = "table-editor", n.innerHTML = `<div class="table-cell-outline" aria-hidden="true"></div><div class="table-cell-tools panel" role="toolbar" aria-label="${N("Table cells")}"><span id="table-cell-position" role="status"></span><button id="table-cell-edit" class="secondary">${N("Edit cell")}</button><label class="sr-only" for="table-row-action">${N("Rows")}</label><select id="table-row-action" aria-label="${N("Rows")}"><option value="">${N("Rows")}</option><option value="before">${N("Insert row above")}</option><option value="after">${N("Insert row below")}</option><option value="delete">${N("Delete selected rows")}</option></select><label class="sr-only" for="table-column-action">${N("Columns")}</label><select id="table-column-action" aria-label="${N("Columns")}"><option value="">${N("Columns")}</option><option value="before">${N("Insert column left")}</option><option value="after">${N("Insert column right")}</option><option value="delete">${N("Delete selected columns")}</option></select><button id="table-cell-language" class="secondary" aria-describedby="table-cell-position">${N("Content language")}</button><button id="table-cell-clear" class="text-btn">${N("Clear cells")}</button><button id="table-cell-reset" class="text-btn" hidden>${N("Use latest value")}</button><button id="table-cell-done" class="primary">${N("Done")}</button><p id="table-cell-error" role="alert" hidden></p><span class="table-cell-help">${N("Arrows select cells · Shift extends selection · Enter edits · Tab moves · Escape cancels")}</span></div><div id="table-cell-grid" class="sr-only" role="grid" aria-label="${N("Table cells")}" tabindex="0" aria-activedescendant="table-active-cell"><div role="row"><div role="gridcell" id="table-active-cell" aria-selected="true" data-user-content></div></div></div>`, e.canvas().parentElement.append(n), d.bind(n), p();
    const y = document.createElement("button");
    y.id = "table-cell-extend", y.className = "secondary", y.textContent = N("Extend selection"), y.setAttribute("aria-pressed", "false"), y.title = N(
      "Turn on Extend selection, then click another cell to select a range."
    ), n.querySelector("#table-cell-edit").after(y), n.querySelector(".table-cell-help").textContent += ` · ${y.title}`, y.onclick = () => {
      !h() || !t || (t.extend = !t.extend, s = null, Q());
    }, n.querySelector("#table-cell-edit").onclick = () => R(), n.querySelector("#table-cell-clear").onclick = () => {
      h() && (L(), Q());
    }, n.querySelector("#table-cell-done").onclick = () => {
      h() && (x(), e.draw(), e.canvas().focus({ preventScroll: !0 }));
    }, n.querySelector("#table-cell-reset").onclick = () => {
      const T = { ...t.end };
      h(!1), P(T), R();
    };
    for (const T of ["row", "column"])
      n.querySelector(`#table-${T}-action`).onchange = (O) => {
        const J = O.target.value;
        O.target.value = "", G(T, J);
      };
    n.addEventListener("keydown", (T) => {
      te(T) && T.stopPropagation();
    }), Q(), e.draw(), !(!t || !n) && (z ? R() : (e.reveal(Oe(C(), t.end)), n?.querySelector("#table-cell-grid").focus({ preventScroll: !0 })));
  }
  function P(u, v = !1, z = !0) {
    const y = C();
    y && (u = {
      r: Math.max(0, Math.min(y.cells.length - 1, u.r)),
      c: Math.max(0, Math.min(y.cells[0].length - 1, u.c))
    }, v || (t.anchor = u), t.end = u, z && e.reveal(Oe(y, u)), Q());
  }
  function R(u) {
    const v = C();
    if (!v || !e.writable(v)) return D("This table is protected.");
    if (r) {
      r.focus();
      return;
    }
    const { r: z, c: y } = t.end;
    t.anchor = { r: z, c: y }, a = l.get(S()) || {
      key: S(),
      r: z,
      c: y,
      rows: v.cells.length,
      cols: v.cells[0].length,
      value: v.cells[z][y],
      original: Fe(v, z, y, !1)
    };
    const T = document.createElement("textarea");
    T.id = "table-cell-input";
    const O = document.createElement("span");
    O.id = "table-cell-input-label", O.className = "sr-only", O.textContent = `${N("Rows")} ${z + 1}, ${N("Columns")} ${y + 1}`;
    const J = document.createElement("div");
    J.className = "table-cell-field", J.append(O, T), n.append(J);
    const X = a.content || a.original;
    r = jn(T, X, {
      maxLength: 2e3,
      inheritedLanguage: v.lang,
      languageButton: n.querySelector("#table-cell-language")
    });
    const K = r.parentElement;
    K.prepend(O), J.replaceWith(K), K.className = "table-cell-field", n.querySelector(".table-cell-tools").append(r.languageControls), u !== void 0 && r.setRichText(u, []), r.addEventListener("input", j), e.reveal(Oe(v, t.end), !0), Q(), r.focus({ preventScroll: !0 }), u === void 0 ? r.select() : r.setSelectionRange(r.value.length, r.value.length);
  }
  function L() {
    const u = C(), v = f(), z = {};
    for (let y = v.r; y < v.r + v.rows; y++)
      for (let T = v.c; T < v.c + v.cols; T++) {
        const O = u.cellLanguages?.[`${y},${T}`]?.lang;
        z[`${y},${T}`] = O ? { lang: O } : {};
      }
    return M(nn(u.cells, v), void 0, z);
  }
  function G(u, v) {
    if (!v || !h()) return;
    const z = C();
    if (!z || !e.writable(z)) return D("This table is protected.");
    const y = f(), T = z.cells.length, O = z.cells[0].length;
    let J = z.cells.map((Z) => [...Z]);
    if (u === "row")
      if (v === "delete") {
        if (y.rows === T)
          return D("Keep at least one row and one column.");
        J.splice(y.r, y.rows);
      } else
        J.splice(
          y.r + (v === "after" ? y.rows : 0),
          0,
          Array(O).fill("")
        );
    else {
      if (v === "delete" && y.cols === O)
        return D("Keep at least one row and one column.");
      J.forEach(
        (Z) => v === "delete" ? Z.splice(y.c, y.cols) : Z.splice(y.c + (v === "after" ? y.cols : 0), 0, "")
      );
    }
    const X = u === "row" ? y.r : y.c, K = u === "row" ? y.rows : y.cols;
    M(J, {
      axis: u,
      index: X + (v === "after" ? K : 0),
      remove: v === "delete" ? K : 0,
      insert: v === "delete" ? 0 : 1
    }) && P({ r: y.r, c: y.c });
  }
  function H(u, v = !1) {
    const z = C();
    let { r: y, c: T } = t.end;
    u === "Tab" ? (T += v ? -1 : 1, T < 0 && y > 0 ? (T = z.cells[0].length - 1, y--) : T >= z.cells[0].length && y < z.cells.length - 1 && (T = 0, y++)) : (y += { ArrowDown: 1, ArrowUp: -1 }[u] || 0, T += { ArrowRight: 1, ArrowLeft: -1 }[u] || 0), P({ r: y, c: T }, u !== "Tab" && v);
  }
  function te(u) {
    if (d.keydown(u)) return !0;
    if (!t || u.defaultPrevented || u.isComposing || u.keyCode === 229 || u.target.closest?.("select,input") || u.target.closest?.("button") && u.key !== "Escape")
      return !1;
    const v = u.ctrlKey || u.metaKey;
    if (u.key === "Tab" && !v && !u.altKey) {
      const y = C(), T = t.end;
      if (u.shiftKey ? T.r === 0 && T.c === 0 : T.r === y.cells.length - 1 && T.c === y.cells[0].length - 1)
        return r && !h() ? (u.preventDefault(), !0) : (((u.shiftKey ? n.querySelector(
          ".table-cell-tools button:not(:disabled):last-child"
        ) : n.querySelector("[data-table-resize]:not([hidden])")) || n.querySelector("#table-cell-done")).focus(), u.preventDefault(), !0);
    }
    let z = !0;
    if (r)
      u.key === "Escape" ? (h(!1), Q(), e.canvas().focus({ preventScroll: !0 })) : u.key === "Tab" || u.key === "Enter" && !u.shiftKey ? h() && (v || H(u.key === "Enter" ? "ArrowDown" : "Tab", u.shiftKey), v ? e.canvas().focus({ preventScroll: !0 }) : R()) : z = !1;
    else if (u.key === "Escape")
      x(!1), e.draw(), e.canvas().focus({ preventScroll: !0 });
    else if (u.key.startsWith("Arrow") && !v && !u.altKey || u.key === "Tab" && !v && !u.altKey)
      H(u.key, u.shiftKey);
    else if (u.key === "Enter" || u.key === "F2") R();
    else if (v && u.key.toLowerCase() === "a") {
      t.anchor = { r: 0, c: 0 };
      const y = C();
      t.end = { r: y.cells.length - 1, c: y.cells[0].length - 1 }, Q();
    } else ["Backspace", "Delete"].includes(u.key) ? (L(), Q()) : !v && !u.altKey && u.key.length === 1 && u.key !== " " ? R(u.key) : z = !1;
    return z && u.preventDefault(), z;
  }
  function se(u, v) {
    if (d.down(u, v)) return !0;
    const z = C(), y = Vt(z, v);
    if (!y)
      return x(), !1;
    if (!h()) return !0;
    const T = performance.now();
    return !u.shiftKey && !t.extend && s?.r === y.r && s?.c === y.c && T - s.at < 400 ? (s = null, R(), !0) : (s = { ...y, at: T }, o = { anchor: { ...t.anchor }, end: { ...t.end } }, P(y, u.shiftKey || t.extend, !1), !0);
  }
  function fe(u) {
    if (!d.move(u) && o && C()) {
      const v = Vt(C(), u, !0);
      (v.r !== t.end.r || v.c !== t.end.c) && (P(v, !0, !1), s = null);
    }
  }
  function Ue(u = !1) {
    d.end(u) || (u && o && t && (t.anchor = o.anchor, t.end = o.end, Q()), o = null);
  }
  function je(u) {
    if (!(!t || !C() || !u.clipboardData || u.defaultPrevented || document.querySelector("dialog[open]")) && !(u.target.closest?.("input,textarea,[contenteditable]") && u.target !== r) && !(r && u.type !== "paste"))
      try {
        if (u.type === "paste") {
          const v = On(u.clipboardData);
          let z = v?.cells;
          if (!z && (r || u.clipboardData.files?.length)) return;
          if (!z) {
            const V = u.clipboardData.getData("text/plain");
            if (!V) return;
            z = [[V]];
          }
          if (u.preventDefault(), u.stopImmediatePropagation(), !tt(z)) return D(et);
          if (!h()) return;
          const y = C(), T = f(), O = Vn(y.cells, z, T), J = {}, X = z.length === 1 && z[0].length === 1, K = X ? T.rows : z.length, Z = X ? T.cols : z[0].length;
          for (let V = 0; V < K; V++)
            for (let le = 0; le < Z; le++) {
              const he = `${T.r + V},${T.c + le}`, Se = y.cellLanguages?.[he]?.lang;
              J[he] = v?.cellLanguages?.[`${X ? 0 : V},${X ? 0 : le}`] || (Se ? { lang: Se } : {});
            }
          M(O, void 0, J), Q();
        } else {
          if (u.preventDefault(), u.stopImmediatePropagation(), u.type === "cut" && !e.writable(C()))
            return D("This table is protected.");
          for (const [v, z] of Object.entries(
            Kn(C().cells, f(), C())
          ))
            u.clipboardData.setData(v, z);
          u.type === "cut" && (L(), Q());
        }
      } catch (v) {
        u.preventDefault(), u.stopImmediatePropagation(), D(v.message);
      }
  }
  for (const u of ["copy", "cut", "paste"])
    document.addEventListener(u, je, !0);
  function Q() {
    if (!t) return;
    const u = C();
    if (!u || !e.selected(u)) {
      r && j(), x();
      return;
    }
    const v = d.preview() || u;
    for (const V of [t.anchor, t.end])
      V.r = Math.min(V.r, v.cells.length - 1), V.c = Math.min(V.c, v.cells[0].length - 1);
    d.render(), n.querySelector("#table-cell-extend").setAttribute("aria-pressed", String(!!t.extend));
    const { view: z } = e.state(), y = f(), T = Oe(v, y), O = n.querySelector(".table-cell-outline");
    Object.assign(O.style, {
      left: `${z.x + T.x * z.z}px`,
      top: `${z.y + T.y * z.z}px`,
      width: `${T.w * z.z}px`,
      height: `${T.h * z.z}px`
    });
    const J = `${t.end.r}/${t.end.c}/${y.rows}/${y.cols}/${e.writable(v)}`;
    if (J !== c) {
      c = J, n.querySelector("#table-cell-position").textContent = `${N("Rows")} ${y.r + 1}${y.rows > 1 ? `–${y.r + y.rows}` : ""} · ${N("Columns")} ${y.c + 1}${y.cols > 1 ? `–${y.c + y.cols}` : ""}`;
      for (const V of [
        "table-cell-edit",
        "table-cell-clear",
        "table-cell-language",
        "table-row-action",
        "table-column-action"
      ])
        n.querySelector(`#${V}`).disabled = !e.writable(v);
    }
    const X = n.querySelector("#table-cell-grid"), K = n.querySelector("#table-active-cell");
    X.setAttribute("aria-rowcount", v.cells.length), X.setAttribute("aria-colcount", v.cells[0].length), K.setAttribute("aria-rowindex", t.end.r + 1), K.setAttribute("aria-colindex", t.end.c + 1);
    const Z = Fe(v, t.end.r, t.end.c);
    if (K.innerHTML = Zt(Z), Z.lang ? K.lang = Z.lang : K.removeAttribute("lang"), r) {
      r.inheritLanguage(v.lang);
      const V = Oe(v, { r: a.r, c: a.c }), le = (v.fontSize || 15) * z.z;
      Object.assign(r.style, {
        left: `${z.x + V.x * z.z}px`,
        top: `${z.y + V.y * z.z}px`,
        width: `${V.w * z.z}px`,
        height: `${V.h * z.z}px`,
        padding: `${9 * z.z}px`,
        font: `400 ${le}px/${1.35} ${yt(vt(v))}`,
        background: a.r === 0 ? "#e6ebdf" : v.color || "#ffffff"
      }), r.contentEditable = String(e.writable(v)), r.setAttribute("contenteditable", String(e.writable(v))), r.setAttribute("aria-readonly", String(!e.writable(v))), b(v) || (D(
        "This cell changed or is protected. Your draft is kept; copy it or use the latest value."
      ), n.querySelector("#table-cell-reset").hidden = !1);
    }
  }
  return {
    open: k,
    close: x,
    finish: h,
    render: Q,
    preview: d.preview,
    cursor: d.cursor,
    cancelResize: d.cancel,
    keydown: te,
    down: se,
    move: fe,
    end: Ue,
    isOpen: () => !!t,
    id: () => t?.id
  };
}
const Ht = localStorage.getItem("whiteboard-language");
Mn();
Ht === null ? localStorage.removeItem("whiteboard-language") : localStorage.setItem("whiteboard-language", Ht);
document.documentElement.lang = "fr";
document.documentElement.dataset.theme = "dark";
const rn = Ln("Local field-visibility fixture"), xt = ye("table", 0, 0, { w: 340, h: 225, cells: [["Bonjour, veuillez lire ce tableau.", "Texte"], ["", ""], ["", ""]], cellLanguages: { "0,0": { lang: "fr-CA" } }, columnWidths: [170, 170], rowHeights: [75, 75, 75] });
rn.items = [xt];
const Gn = { board: rn, view: { x: 79.25, y: 69, z: 0.8 } }, Jn = document.getElementById("canvas");
let ft = 0;
const Be = Hn({ state: () => Gn, canvas: () => Jn, selected: () => !0, writable: () => !0, prepare() {
}, reveal() {
}, draw() {
  Be.render();
}, toast() {
}, resize(e, t) {
  ft++, Object.assign(e, t), Be.render();
}, change(e, t, n, r) {
  ft++, Object.assign(e, Jt(e, t, n, r)), Be.render();
} });
function an() {
  const e = document.getElementById("table-cell-input"), t = e?.getBoundingClientRect(), n = document.activeElement, r = document.querySelector(".table-cell-tools")?.getBoundingClientRect();
  parent.postMessage({ audit: "table-cell-fr", description: JSON.stringify({ focus: n?.id || n?.tagName, input: t ? [t.x, t.y, t.width, t.height].map((a) => Math.round(a * 100) / 100) : null, toolbar: r ? [r.x, r.y, r.width, r.height].map((a) => Math.round(a * 100) / 100) : null, entirelyWithinToolbar: !!(t && r && t.x >= r.x && t.y >= r.y && t.right <= r.right && t.bottom <= r.bottom), inputFocused: e === n, zIndex: e ? getComputedStyle(e).zIndex : null, centerInToolbar: !!(t && document.elementFromPoint(t.x + t.width / 2, t.y + t.height / 2)?.closest(".table-cell-tools")), writes: ft }) }, location.origin);
}
addEventListener("focusin", () => requestAnimationFrame(an));
new MutationObserver(() => requestAnimationFrame(an)).observe(document.body, { childList: !0, subtree: !0, attributes: !0, attributeFilter: ["style", "hidden"] });
document.getElementById("open").onclick = () => Be.open(xt);
Be.open(xt);
An();
