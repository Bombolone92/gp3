import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { board as newBoard, item } from "../src/model.js";
import { createFacilitationUI } from "../src/facilitation/ui.js";
import { createTimerUI } from "../src/timer-ui.js";
import { voteOpen } from "../src/facilitation/model.js";
import { setLanguage } from "../src/i18n.js";
const me={uuid:"11111111-1111-4111-8111-111111111111", username:"Local diagnostic"};
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

const results=[];
for(const language of ["en","fr"]){
 for(const role of ["owner","editor","commenter"]){
  let clock=10000;
  const board={...newBoard("Local timing diagnostic"),items:[item("note",0,0,{id:"a",text:"Option A"})],shared:{room:"local-diagnostic"}};
  const host=stubUI(board,{role,me,now:()=>clock});
  let timer;
  setLanguage(language);
  host.api.render();
  try{
   if(role==="owner"){
    host.api.open("vote");
    assert.equal(host.doc.querySelector("#fac-vote-minutes").value,"0");
    host.doc.querySelector("#fac-vote-minutes").value="1";
    host.doc.querySelector("#fac-vote-form").dispatchEvent(new host.doc.defaultView.Event("submit",{bubbles:true,cancelable:true}));
    assert.equal(board.workshop.vote.endsAt,70000);
    assert.equal(board.timer.duration,60000);
   }else{
    board.workshop={vote:{id:"v1",title:"Timed choice",votes:1,multiple:false,anonymous:true,hidden:false,targets:["a"],state:"active",revealed:false,startedAt:10000,endsAt:70000}};
    board.timer={id:"t1",state:"running",duration:60000,remaining:60000,endsAt:70000};
    host.api.open("vote");
   }
   const voteEnd=board.workshop.vote.endsAt;
   timer=createTimerUI({board:()=>board,now:()=>clock,canEdit:()=>role!=="commenter",save:(next)=>{board.timer=next;},toast:()=>{}});
   timer.bind(); timer.open();
   const extend=host.doc.querySelector('[data-timer-extra="300000"]');
   const participantTimeControl=!!host.doc.querySelector('#fac-vote-minutes, [data-fac="vote-extend"], [data-fac="vote-pause"]');
   const voteControlsBefore=host.doc.querySelectorAll('[data-fac="vote-add"]').length;
   if(role!=="commenter"){
    extend.click();
    assert.equal(board.timer.endsAt,370000);
    assert.equal(board.workshop.vote.endsAt,voteEnd);
    host.doc.querySelector('[data-timer-command="pause"]').click();
    assert.equal(board.timer.state,"paused");
    assert.equal(board.workshop.vote.endsAt,voteEnd);
    host.doc.querySelector('[data-timer-command="stop"]').click();
    assert.equal(board.timer.state,"idle");
    assert.equal(board.workshop.vote.endsAt,voteEnd);
   }else assert.equal(extend.disabled,true);
   clock=70000;
   host.api.render(); timer.render();
   assert.equal(voteOpen(board.workshop.vote,clock),false);
   assert.equal(host.doc.querySelectorAll('[data-fac="vote-add"]').length,0);
   results.push({language,role,defaultVoteMinutes:"0 (none)",timedVoteEndsAt:voteEnd,participantTimeControl,workshopTimerWritable:!extend.disabled,voteControlsBefore,voteControlsAtDeadline:0,workshopTimerStateAtDeadline:board.timer.state,panel:host.doc.querySelector('#fac-tabpanel').textContent.replace(/\s+/g,' ').trim()});
   if(role==="owner"){
    host.click('[data-fac="vote-clear"]');
    assert.equal(host.doc.querySelector("#fac-vote-minutes").value,"0");
    host.doc.querySelector("#fac-vote-form").dispatchEvent(new host.doc.defaultView.Event("submit",{bubbles:true,cancelable:true}));
    assert.equal(board.workshop.vote.endsAt,0);
    clock+=600000;
    host.api.render();
    assert.equal(voteOpen(board.workshop.vote,clock),true);
    assert.equal(host.doc.querySelectorAll('[data-fac="vote-add"]').length,1);
    results.push({language,role,untimedPositiveControl:{endsAt:0,elapsedMilliseconds:600000,voteOpen:true,voteControls:1}});
   }
  }finally{timer?.detach();host.close();}
 }
}
console.log(JSON.stringify({scope:"Actual first-party source components in jsdom; no native geometry, AT, network or exception determination",results},null,2));
