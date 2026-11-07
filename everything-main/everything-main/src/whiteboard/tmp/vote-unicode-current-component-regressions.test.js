import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { board as newBoard, item, validateBoard } from '../src/model.js';
import { voteKey } from '../src/facilitation/model.js';
import { owner } from '../tests/collaboration-helpers.js';
import { language, setLanguage, t, objectKind } from '../src/i18n.js';
import { createCanvas } from '../tests/canvas.js';
const { createFacilitationUI } = await import(process.env.VOTE_UNIT_MODULE || '../src/facilitation/ui.js');
const vote = (extra = {}) => ({
  id: "vote1",
  title: "Priorities",
  votes: 2,
  multiple: false,
  anonymous: false,
  hidden: true,
  targets: ["a", "b", "c"],
  state: "active",
  revealed: false,
  startedAt: 1000,
  endsAt: 0,
  ...extra,
});
const ballot = (user, ids, voteId = "vote1", named = true) => [
  voteKey(voteId, user.uuid),
  {
    vote: voteId,
    by: user.uuid,
    ids,
    at: 2000,
    ...(named ? { name: user.username } : {}),
  },
];
const notes = () => [
  item("note", 0, 0, { id: "a", text: "Ship faster" }),
  item("note", 250, 0, { id: "b", text: "=SUM(1)" }),
  item("note", 500, 0, { id: "c", text: "Better docs" }),
];

function stubUI(board, { role, me, selection = new Set(), now = () => 10000 }) {
  const dom = new JSDOM(
    '<div class="canvas-wrap"><canvas id="canvas"></canvas><div class="canvas-navigation"><button data-action="facilitation"></button></div></div>',
  );
  const previous = globalThis.document;
  globalThis.document = dom.window.document;
  const doc = dom.window.document;
  doc.querySelector("#canvas").getBoundingClientRect = () => ({
    left: 0,
    top: 0,
    width: 1600,
    height: 900,
  });
  const calls = { focus: [], bring: 0, timer: [], toasts: [], downloads: [] };
  const api = createFacilitationUI({
    board: () => board,
    identity: () => ({ id: me.uuid, name: me.username }),
    role: () => role,
    canParticipate: () => role !== "viewer",
    canEdit: () => ["owner", "facilitator", "editor"].includes(role),
    now,
    view: () => ({ x: 0, y: 0, z: 1 }),
    canvas: () => doc.querySelector("#canvas"),
    hidden: () => new Map(),
    selection: () => selection,
    select: () => {},
    commit(workshop) {
      if (workshop) board.workshop = workshop;
      else delete board.workshop;
      api.render();
    },
    setTimer(timer) {
      calls.timer.push(timer);
      board.timer = timer;
    },
    focusFrame: (frame) => calls.focus.push(frame.id),
    bring: () => calls.bring++,
    follow: () => {},
    session: () => null,
    roster: () => [],
    icon: (name) => `<i data-lucide="${name}" aria-hidden="true"></i>`,
    toast: (message) => calls.toasts.push(message),
    download: (...args) => calls.downloads.push(args),
    draw: () => {},
  });
  api.bind(doc.querySelector(".canvas-wrap"));
  return {
    api,
    doc,
    calls,
    click(selector) {
      const el = doc.querySelector(selector);
      assert.ok(el, selector);
      el.click();
    },
    banner: () =>
      doc.querySelector("#workshop-banner").hidden
        ? ""
        : doc.querySelector("#workshop-banner").textContent,
    close() {
      api.detach();
      dom.window.close();
      if (previous === undefined) delete globalThis.document;
      else globalThis.document = previous;
    },
  };
}

for (const length of [118,119,120]) {
  test(`voting previews retain complete Unicode at ${length} characters`, () => {
    const n=notes();n[0].text="Q".repeat(length)+"😀";n[0].lang="fr-CA";
    const b={...newBoard("Unicode votes"),items:n,workshop:Object.fromEntries([["vote",vote({targets:["a"],hidden:false})],ballot(owner,["a"])])};
    validateBoard(b);
    const ui=stubUI(b,{role:"owner",me:owner});
    try {
      ui.api.open("vote");
      const caption=ui.doc.querySelector('.fac-vote-list [data-user-content]');
      assert.equal(caption.textContent.isWellFormed(),true);
      assert.equal(caption.lang,"fr-CA");
      assert.equal(n[0].text,"Q".repeat(length)+"😀");
    }finally{ui.close();}
  });
  test(`completed votes retain complete Unicode at ${length} characters`, () => {
    const n=notes();n[0].text="Q".repeat(length)+"😀";n[0].lang="fr-CA";
    const b={...newBoard("Unicode votes"),items:n,workshop:Object.fromEntries([["vote",vote({targets:["a"],hidden:false})],ballot(owner,["a"])])};
    validateBoard(b);
    const ui=stubUI(b,{role:"owner",me:owner});
    try {
      ui.api.open("vote");ui.click('[data-fac="vote-end"]');
      const record=Object.values(b.workshop).find(r=>r.results),result=record.results[0];
      assert.equal(result.label.isWellFormed(),true);
      validateBoard(b);
      assert.equal(n[0].text,"Q".repeat(length)+"😀");
    }finally{ui.close();}
  });
}


for (const locale of ['en','fr'])
  for (const length of [118,119,120])
    test(`voting Unicode labels preserve exact whole and passage languages in ${locale} at ${length}`,()=>{
      const previous=language;
      const n=notes(),text='Q'.repeat(length)+'😀',expected=length===118?text:'Q'.repeat(Math.min(length,120));
      n[0].text=text;n[0].lang='fr-CA';n[0].textRuns=[{start:length,end:length+2,style:{lang:'en-GB'}}];
      const original=structuredClone(n);
      const b={...newBoard('Unicode votes'),items:n,workshop:Object.fromEntries([['vote',vote({targets:['a'],hidden:false})],ballot(owner,['a'])])};
      validateBoard(b);const ui=stubUI(b,{role:'owner',me:owner});
      try {
        setLanguage(locale);ui.api.open('vote');const caption=ui.doc.querySelector('.fac-vote-list [data-user-content]');
        assert.equal(caption.textContent,expected);assert.equal(caption.lang,'fr-CA');
        assert.equal(caption.querySelector('[lang="en-GB"]')?.textContent,length===118?'😀':undefined);
        ui.click('[data-fac="vote-end"]');const record=Object.values(b.workshop).find(r=>r.results),result=record.results[0];
        assert.equal(result.label,expected);assert.equal(result.lang,'fr-CA');
        assert.deepEqual(result.textRuns,length===118?[{start:118,end:120,style:{lang:'en-GB'}}]:undefined);
        validateBoard(b);assert.deepEqual(n,original);
      }finally{setLanguage(previous);ui.close();}
    });


for(const locale of ['en','fr'])
  test(`long table vote labels retain translated prefix and exact captured cell languages in ${locale}`,()=>{
    const table=item('table',0,0,{id:'a',cells:[['Intro','Q'.repeat(291)+'😀']],lang:'de',cellLanguages:{'0,1':{lang:'fr-CA',textRuns:[{start:291,end:293,style:{lang:'en-GB'}}]}}});
    const original=structuredClone(table),b={...newBoard('Long table votes'),items:[table],workshop:Object.fromEntries([['vote',vote({targets:['a'],hidden:false})],ballot(owner,['a'])])};
    validateBoard(b);const ui=stubUI(b,{role:'owner',me:owner}),previous=language;
    try {
      setLanguage(locale);const prefix=locale==='en'?'Table: ':'tableau de données: ',expected=prefix+'Intro · '+'Q'.repeat(120-prefix.length-8);
      ui.api.open('vote');const preview=ui.doc.querySelector('.fac-vote-list li');assert.ok(preview.textContent.includes(expected));
      ui.click('[data-fac="vote-end"]');const result=Object.values(b.workshop).find(r=>r.results).results[0];
      assert.equal(result.label,expected);assert.equal(result.lang,locale);
      assert.deepEqual(result.textRuns,[{start:prefix.length,end:prefix.length+8,style:{lang:'de'}},{start:prefix.length+8,end:120,style:{lang:'fr-CA'}}]);
      validateBoard(b);assert.deepEqual(table,original);
    }finally{setLanguage(previous);ui.close();}
  });

for (const locale of ['en','fr'])
  for (const type of ['image','file','table'])
    test(`voting captured ${type} names preserve the boundary and authored body language in ${locale}`,()=>{
      const previous=language;
      const target=item(type,0,0,{id:'a',text:'',lang:'fr-CA',...(type==='image'?{src:createCanvas(2,2).toDataURL()}:type==='file'?{data:'data:application/octet-stream;base64,eA==',fileName:''}:{cells:[['']]})});
      const b={...newBoard('Alternative vote labels'),items:[target],workshop:Object.fromEntries([['vote',vote({targets:['a'],hidden:false})],ballot(owner,['a'])])};
      const ui=stubUI(b,{role:'owner',me:owner});
      try{
        setLanguage(locale);
        const prefix=objectKind(target)+': ',short='Q'.repeat(119-prefix.length),body=short+'😀',expected=prefix+short;
        if(type==='image')target.alt=body;
        else if(type==='file')target.fileName=body;
        else target.cells=[[body]];
        const original=structuredClone(target);
        validateBoard(b);ui.api.open('vote');
        const caption=ui.doc.querySelector('.fac-vote-list [data-user-content]');
        assert.equal(caption.textContent,short);
        assert.equal(caption.lang,'fr-CA');
        ui.click('[data-fac="vote-end"]');
        const result=Object.values(b.workshop).find(r=>r.results).results[0];
        assert.equal(result.label,expected);
        assert.equal(result.label.isWellFormed(),true);
        assert.equal(result.lang,locale);
        assert.deepEqual(result.textRuns,[{start:prefix.length,end:119,style:{lang:'fr-CA'}}]);
        validateBoard(b);assert.deepEqual(target,original);
      }finally{setLanguage(previous);ui.close();}
    });
