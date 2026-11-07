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

const code=await appBundle();
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

async function database(factory){return new Promise((resolve,reject)=>{const r=factory.open('whiteboard-v1',3);r.onupgradeneeded=()=>{for(const name of ['boards','templates'])r.result.createObjectStore(name,{keyPath:'id'});for(const [name,key]of [['revisions','boardId'],['collaboration','scope']]){const s=r.result.createObjectStore(name,{keyPath:'id'});s.createIndex(key,key);}};r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});}
async function readStored(factory,id){const db=await database(factory);try{return await new Promise((resolve,reject)=>{const tx=db.transaction('boards');const request=tx.objectStore('boards').get(id);tx.oncomplete=()=>resolve(request.result);tx.onerror=()=>reject(tx.error);});}finally{db.close();}}
const results=[];
for(const lang of ['en','fr']){
 const factory=new IDBFactory(),plan=board('Local recovery audit '+lang);
 plan.items=[item('note',20,40,{text:'Veuillez discuter les prochaines étapes. Read first.',lang:'fr-CA',textRuns:[{start:39,end:50,style:{lang:'en-CA'}}]})];
 validateBoard(plan);
 const db=await database(factory);await new Promise((resolve,reject)=>{const tx=db.transaction('boards','readwrite');tx.objectStore('boards').put(plan);tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);});db.close();
 let app=await setup(undefined,{indexedDB:factory,preferences:{'whiteboard-language':lang}});
 try{
  assert.equal(app.doc.querySelectorAll('.board-card').length,1);
  const baseline=JSON.stringify(await readStored(factory,plan.id));
  await app.click('[data-more]');await app.click('#remove-board');
  const review=app.doc.querySelector('dialog[open]');
  assert.ok(review.textContent.includes(plan.title));
  assert.equal(JSON.stringify(await readStored(factory,plan.id)),baseline,'Opening confirmation preserves complete saved board');
  await app.click('#cancel-delete');
  assert.equal(JSON.stringify(await readStored(factory,plan.id)),baseline,'Keep board cancels without data change');
  await app.click('[data-more]');await app.click('#remove-board');await app.click('#confirm-delete');
  const trashed=await readStored(factory,plan.id);assert.ok(trashed.deletedAt);
  delete trashed.deletedAt;assert.equal(JSON.stringify(trashed),baseline,'Deletion only marks the recoverable board');
  assert.equal(app.doc.querySelectorAll('.board-card').length,0);
  app.close();app=await setup(undefined,{indexedDB:factory,preferences:{'whiteboard-language':lang}});
  assert.equal(app.doc.querySelectorAll('.board-card').length,0);
  await app.click('[data-filter="trash"]');assert.equal(app.doc.querySelectorAll('.board-card').length,1);
  await app.click('[data-open]');await app.click('#restore-board');
  assert.equal(JSON.stringify(await readStored(factory,plan.id)),baseline,'Restoration after a fresh app load retains exact saved board');
  await app.click('[data-filter="all"]');await app.click('[data-open]');
  assert.equal(app.doc.querySelectorAll('#board-outline [data-id]').length,1);
  results.push({lang,reviewShowsBoard:true,cancelPreservesExactBoard:true,deleteOnlyAddsRecoverableMarker:true,reloadRetainsTrash:true,restorePreservesExactBoard:true,reopenObjects:1,scope:'Actual production bundle, in-memory IndexedDB, DOM/service behavior; no native layout, clipboard or AT credit'});
 }finally{app.close();}
}
console.log(JSON.stringify(results,null,2));
