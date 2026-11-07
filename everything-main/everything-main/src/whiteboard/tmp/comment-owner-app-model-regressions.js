
async function commentOwnerBoard(app) {
  await app.click('[data-action="export"]');
  const format=app.doc.querySelector('#export-format');
  format.value='json';format.dispatchEvent(new app.w.Event('change',{bubbles:true}));
  const count=app.downloads.length;
  await app.click('dialog button.primary');
  for(let n=0;n<100&&app.downloads.length===count;n++)await app.tick();
  assert.equal(app.downloads.length,count+1);
  return JSON.parse(await new Promise(resolve=>{
    const reader=new app.w.FileReader();reader.onload=()=>resolve(reader.result);reader.readAsText(app.downloads.at(-1));
  }));
}
for(const foreign of ['control','pointerdown','pointermove','pointerup','pointercancel','lostpointercapture','click'])
  test(`comment pin moves retain their owner through foreign ${foreign} and preserve saved position and drawing history`,async()=>{
    const app=await setup();
    try {
      await app.click('[data-action="new"]');
      app.doc.querySelector('#canvas').getBoundingClientRect=()=>({left:0,top:0,width:1200,height:900});
      dispatchTransfer(app,'paste',transferData({'text/plain':'Review target'}));
      await app.click('[data-action="add-comment"]');
      app.doc.querySelector('#comment-text').value='Review';
      await app.click('#comment-form [type="submit"]');
      const id=app.doc.querySelector('[data-thread]').dataset.thread;
      await app.click('#comments-close');
      const before=await commentOwnerBoard(app);
      const {commentPoint}=await import('../src/comments.js');
      const point=board=>commentPoint(board.comments.find(c=>c.id===id),new Map(board.items.map(i=>[i.id,i])));
      const original=point(before),zoom=renderedView(app).z;
      const pin=app.doc.querySelector(`[data-comment="${id}"]`),start=parseFloat(pin.style.left);
      const history=['undo','redo'].map(key=>app.doc.querySelector(`[data-action="${key}"]`).disabled);
      cropPointer(app,pin,'pointerdown',41,500,200);
      cropPointer(app,pin,'pointermove',41,620,200);
      if(foreign==='click') {
        const e=new app.w.MouseEvent('click',{detail:1,bubbles:true});Object.defineProperty(e,'pointerId',{value:42});pin.dispatchEvent(e);
      }else if(foreign!=='control')cropPointer(app,pin,foreign,42,620,200);
      assert.equal(app.doc.querySelector('#comments-panel'),null,'Foreign events cannot open the discussion during an owned move');
      assert.equal(parseFloat(pin.style.left),start+120,'A foreign pointer preserves the draft');
      cropPointer(app,pin,'pointermove',41,660,200);
      assert.equal(parseFloat(pin.style.left),start+160,'The owner can continue moving');
      cropPointer(app,pin,'pointerup',41,660,200);
      assert.deepEqual(['undo','redo'].map(key=>app.doc.querySelector(`[data-action="${key}"]`).disabled),history);
      const after=await commentOwnerBoard(app),saved=point(after);
      assert.deepEqual(after.items,before.items,'Moving a comment preserves board objects');
      assert.ok(Math.abs(saved.x-original.x-160/zoom)<1e-7);
      assert.ok(Math.abs(saved.y-original.y)<1e-7);
      await app.click('[data-action="home"]');await app.click('[data-open]');
      const reopened=await commentOwnerBoard(app);
      assert.deepEqual(reopened.comments,after.comments,'The owner position survives reopening');
      assert.deepEqual(reopened.items,before.items);
      await app.click('[data-action="home"]');
    }finally{app.close();}
  });

for(const ending of ['pointercancel','lostpointercapture'])
  test(`comment pin owner ${ending} preserves saved anchors, redo and later keyboard moves`,async()=>{
    const app=await setup();
    try {
      await app.click('[data-action="new"]');
      app.doc.querySelector('#canvas').getBoundingClientRect=()=>({left:0,top:0,width:1200,height:900});
      dispatchTransfer(app,'paste',transferData({'text/plain':'Review target'}));
      await app.click('[data-action="add-comment"]');
      app.doc.querySelector('#comment-text').value='Review';
      await app.click('#comment-form [type="submit"]');
      const id=app.doc.querySelector('[data-thread]').dataset.thread;
      await app.click('#comments-close');
      await app.click('[data-action="duplicate"]');
      await app.click('[data-action="undo"]');
      assert.equal(app.doc.querySelector('[data-action="redo"]').disabled,false);
      const before=await commentOwnerBoard(app),pin=app.doc.querySelector(`[data-comment="${id}"]`);
      const left=pin.style.left,top=pin.style.top;
      cropPointer(app,pin,'pointerdown',41,500,200);cropPointer(app,pin,'pointermove',41,620,200);
      cropPointer(app,pin,ending,41,620,200);cropPointer(app,pin,'pointerup',41,620,200);
      assert.equal(pin.style.left,left);assert.equal(pin.style.top,top);
      assert.equal(app.doc.querySelector('[data-action="redo"]').disabled,false);
      const cancelled=await commentOwnerBoard(app);
      assert.deepEqual(cancelled.comments,before.comments);
      assert.deepEqual(cancelled.items,before.items);
      pin.dispatchEvent(new app.w.KeyboardEvent('keydown',{key:'ArrowRight',shiftKey:true,bubbles:true}));
      const moved=await commentOwnerBoard(app);
      const {commentPoint}=await import('../src/comments.js');
      const point=board=>commentPoint(board.comments.find(c=>c.id===id),new Map(board.items.map(i=>[i.id,i])));
      assert.equal(point(moved).x,point(before).x+10);
      assert.equal(point(moved).y,point(before).y);
      assert.deepEqual(moved.items,before.items);
      assert.equal(app.doc.querySelector('[data-action="redo"]').disabled,false);
      await app.click('[data-action="home"]');
    }finally{app.close();}
  });
