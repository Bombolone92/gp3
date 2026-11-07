import { createPeerHub } from "../tests/peer-hub.js";
import { captureCamera } from "../src/collaboration/attention.js";
import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { IDBFactory } from "fake-indexeddb";
import { appBundle } from "../tests/app-bundle.js";
import { createCanvas } from "../tests/canvas.js";
import axe from "axe-core";
import { Image as NativeImage } from "@napi-rs/canvas";
import { board, item, validateBoard } from "../src/model.js";
import { TEMPLATE_CATALOG } from "../src/templates.js";
import { SHAPE_FAMILIES } from "../src/shapes.js";
import { CLIPBOARD_TYPE, clipboardFormats } from "../src/transfer.js";
import { SharedDocument } from "../src/collaboration/document.js";
import { textLinkRects } from "../src/text-links.js";
import { encode, hash } from "../src/collaboration/protocol.js";
import { localDate } from "../src/planning/task.js";
import {
  environment,
  owner,
  editor as collaborator,
  viewer,
} from "../tests/collaboration-helpers.js";
import { build } from "vite";
import { readFileSync } from "node:fs";
const candidate=process.env.WCAG_AI_FEEDBACK_CANDIDATE === "1";
const fixed=candidate || process.env.WCAG_AI_FEEDBACK_FINAL === "1";
async function candidateBundle() {
  const bundle = await build({
    configFile: false,
    plugins:[{name:"local-feedback-candidate",transform(source,id){
      if(!id.endsWith("/src/ai/ai-ui.js"))return null;
      source=readFileSync(new URL("./wcag-ai-preconditions-baseline.js",import.meta.url),"utf8");
      if(!candidate)return source;
      for(const text of ["There is no text to summarize.","Select two or more sticky notes with text.","Select up to 300 sticky notes at a time."]){
        const before=`return toast("${text}");`,after=`return progress(d, "${text}");`;
        assert.equal(source.split(before).length,2);
        source=source.replace(before,after);
      }
      return source;
    }}],
    logLevel: "silent",
    build: {
      write: false,
      rollupOptions: {
        output: {
          manualChunks: (id) => (/pdfjs-dist/.test(id) ? undefined : "index"),
        },
      },
    },
  });
  return bundle.output.find((file) => file.type === "chunk" && file.isEntry)
    .code;
}

const code = process.env.WCAG_AI_FEEDBACK_FINAL === "1" ? await appBundle() : await candidateBundle();
async function setup(
  puter,
  {
    asyncDialogClose = false,
    imageClass = NativeImage,
    digestGate,
    url = "https://whiteboard.test",
    indexedDB,
    preferences = {},
  } = {},
) {
  const dom = new JSDOM('<div id="app"></div><div id="toast"></div>', {
    url,
    runScripts: "outside-only",
    pretendToBeVisual: true,
  });
  const w = dom.window;
  for (const [key, value] of Object.entries(preferences))
    w.localStorage.setItem(key, value);
  // Board data is JSON-compatible. Keep cloned objects in the browser realm,
  // as native structuredClone does, so Yjs recognizes their constructors.
  w.structuredClone = (value) => w.JSON.parse(w.JSON.stringify(value));
  w.TextEncoder = TextEncoder;
  w.TextDecoder = TextDecoder;
  Object.defineProperty(w.crypto, "subtle", {
    value: digestGate
      ? new Proxy(crypto.subtle, {
          get(target, key) {
            if (key === "digest")
              return async (...args) => {
                await digestGate();
                return target.digest(...args);
              };
            const value = target[key];
            return typeof value === "function" ? value.bind(target) : value;
          },
        })
      : crypto.subtle,
  });
  w.indexedDB = indexedDB || new IDBFactory();
  w.matchMedia = () => ({ matches: false, addEventListener() {} });
  w.puter = puter;
  w.Image = imageClass;
  const downloads = [];
  w.URL.createObjectURL = (blob) => {
    downloads.push(blob);
    return "blob:test";
  };
  w.URL.revokeObjectURL = () => {};
  const names = [];
  w.HTMLAnchorElement.prototype.click = function () {
    if (this.download) names.push(this.download);
  };
  w.HTMLCanvasElement.prototype.setPointerCapture = () => {};
  w.HTMLCanvasElement.prototype.getContext = function () {
    if (
      !this._native ||
      this._native.width !== this.width ||
      this._native.height !== this.height
    )
      this._native = createCanvas(this.width, this.height);
    const ctx = this._native.getContext("2d");
    if (!ctx._domCanvasImages) {
      const drawImage = ctx.drawImage;
      ctx.drawImage = function (image, ...args) {
        return drawImage.call(this, image._native || image, ...args);
      };
      ctx._domCanvasImages = true;
    }
    return ctx;
  };
  w.HTMLCanvasElement.prototype.toDataURL = function () {
    return this._native.toDataURL("image/png");
  };
  w.HTMLCanvasElement.prototype.toBlob = function (cb) {
    cb(new w.Blob([this._native.toBuffer("image/png")], { type: "image/png" }));
  };
  w.HTMLDialogElement.prototype.showModal = function () {
    this.open = true;
  };
  w.HTMLDialogElement.prototype.close = function () {
    this.open = false;
    const close = () => this.dispatchEvent(new w.Event("close"));
    if (asyncDialogClose) w.setTimeout(close, 0);
    else close();
  };
  await w.eval(`(async()=>{${code}\n})()`);
  const tick = () => new Promise((r) => setTimeout(r, 25));
  const click = async (selector) => {
    const el = w.document.querySelector(selector);
    assert.ok(el, selector);
    const opensBoard =
      el.dataset.action === "new" ||
      (!w.document.querySelector("#canvas") &&
        (el.dataset.use || el.dataset.template));
    el.click();
    await tick();
    if (opensBoard) {
      const deadline = Date.now() + 3000;
      while (!w.document.querySelector("#canvas") && Date.now() < deadline)
        await tick();
      assert.ok(w.document.querySelector("#canvas"), "Board finished opening");
    }
  };
  return {
    w,
    doc: w.document,
    click,
    tick,
    downloads,
    names,
    close: () => w.close(),
  };
}

function transferData(formats = {}, files = []) {
  const values = new Map(Object.entries(formats));
  return {
    files,
    get types() {
      return [...values.keys(), ...(files.length ? ["Files"] : [])];
    },
    getData(type) {
      return values.get(type) || "";
    },
    setData(type, value) {
      values.set(type, value);
    },
  };
}
function dispatchTransfer(app, type, data, target, point = {}) {
  const event = new app.w.Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(
    event,
    ["copy", "cut", "paste"].includes(type) ? "clipboardData" : "dataTransfer",
    { value: data },
  );
  Object.assign(event, point);
  (target || app.doc.querySelector("#canvas")).dispatchEvent(event);
  return event;
}
function selectedClipboard(app) {
  const data = transferData();
  dispatchTransfer(app, "copy", data);
  return JSON.parse(data.getData(CLIPBOARD_TYPE)).items;
}

import { readFile } from "node:fs/promises";
const css=await readFile(new URL("../src/style.css",import.meta.url),"utf8");
const toastCSS=css.slice(css.indexOf("#toast {"),css.indexOf(".fatal {",css.indexOf("#toast {")));
async function run(lang,scenario){
 let requests=0;
 const app=await setup({env:"web",auth:{isSignedIn:()=>true,getUser:async()=>({username:"local-audit"})},ai:{chat:async()=>{requests++;throw Error("No request expected");}}},{preferences:{"whiteboard-language":lang}});
 try{
  const style=app.doc.createElement("style");style.textContent=toastCSS;app.doc.head.append(style);
  await app.click('[data-action="new"]');
  const count=scenario==="limit" ? 301 : scenario==="blank" ? 2 : 0;
  if(count)dispatchTransfer(app,"paste",transferData(clipboardFormats(Array.from({length:count},(_,n)=>item("note",(n%20)*230,Math.floor(n/20)*210,{text:scenario==="blank" ? "" : `Local option ${n}`})))));
  await app.tick();
  const before=count ? selectedClipboard(app) : [];
  assert.equal(before.length,count);
  await app.click('[data-action="ai"]');
  const d=app.doc.querySelector("dialog[open]");
  const action=scenario==="empty" ? "summarize" : "themes";
  const button=d.querySelector(`[data-ai="${action}"]`);
  assert.equal(button.disabled,false);
  await app.click(`[data-ai="${action}"]`);
  const toast=app.doc.querySelector("#toast");
  const first={message:toast.textContent,visible:toast.classList.contains("visible"),opacity:app.w.getComputedStyle(toast).opacity,persistentStatus:d.querySelector("#ai-status").textContent};
  const expected={en:{limit:"Select up to 300 sticky notes at a time.",blank:"Select two or more sticky notes with text.",empty:"There is no text to summarize."},fr:{limit:"Sélectionnez jusqu’à 300 notes adhésives à la fois.",blank:"Sélectionnez au moins deux notes adhésives contenant du texte.",empty:"Il n’y a aucun texte à résumer."}}[lang][scenario];
  if(fixed){assert.equal(first.persistentStatus,expected);assert.equal(first.visible,false);}else{assert.equal(first.visible,true);assert.equal(first.opacity,"1");assert.equal(first.persistentStatus,"");}
  await new Promise(r=>setTimeout(r,4750));
  const later={message:toast.textContent,visible:toast.classList.contains("visible"),opacity:app.w.getComputedStyle(toast).opacity,persistentStatus:d.querySelector("#ai-status").textContent,dialogText:d.textContent.replace(/\s+/g," ").trim()};
  assert.equal(later.visible,false);assert.equal(later.opacity,"0");assert.equal(later.persistentStatus,fixed ? expected : "");
  const untimed=d.cloneNode(true);untimed.querySelector("#toast")?.remove();
  assert.equal(untimed.textContent.includes(expected),fixed);
  assert.equal(requests,0);
  d.close();await app.tick();
  if(count)assert.deepEqual(selectedClipboard(app),before);
  else assert.equal(app.doc.querySelectorAll("#board-outline [data-id]").length,0);
  return {candidate,actualFinal:fixed && !candidate,language:lang,scenario,first,later,requests,selectedNotes:before.length,boardUnchanged:true,scope:"Actual built app and actual toast styles in jsdom; no native rendering or AT credit"};
 }finally{app.close();}
}
console.log(JSON.stringify(await Promise.all(["en","fr"].flatMap(lang=>["limit","blank","empty"].map(scenario=>run(lang,scenario)))),null,2));
