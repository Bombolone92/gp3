for (const foreign of ["control", "pointerdown", "pointermove", "pointerup", "pointercancel", "lostpointercapture", "click"])
 test(`comment pin retains its owner through foreign ${foreign}`, async () => {
  const app=await setup();
  try {
   await app.click('[data-action="new"]');
   app.doc.querySelector('#canvas').getBoundingClientRect=()=>({left:0,top:0,width:1200,height:900});
   dispatchTransfer(app,"paste",transferData({"text/plain":"Review target"}));
   await app.click('[data-action="add-comment"]');
   app.doc.querySelector('#comment-text').value='Review';
   await app.click('#comment-form [type="submit"]');
   const id=app.doc.querySelector('[data-thread]').dataset.thread;
   await app.click('#comments-close');
   let pin=app.doc.querySelector(`[data-comment="${id}"]`);
   const left=()=>parseFloat(pin.style.left), start=left();
   const original=selectedClipboard(app);
   const history=['undo','redo'].map(key=>app.doc.querySelector(`[data-action="${key}"]`).disabled);
   const point=()=>{const v=renderedView(app);return [(left()-v.x)/v.z,(parseFloat(pin.style.top)-v.y)/v.z]};
   const before=point(), zoom=renderedView(app).z;
   cropPointer(app,pin,"pointerdown",41,500,200);
   cropPointer(app,pin,"pointermove",41,620,200);
   assert.equal(left(),start+120);
   if(foreign==="click") {
    const e=new app.w.MouseEvent('click',{detail:1,bubbles:true});
    Object.defineProperty(e,'pointerId',{value:42});pin.dispatchEvent(e);
   } else if(foreign!=="control") cropPointer(app,pin,foreign,42,620,200);
   assert.equal(app.doc.querySelector('#comments-panel'),null,'Foreign events cannot open the discussion during an owned move');
   assert.equal(left(),start+120,"Foreign pointer retains draft position");
   cropPointer(app,pin,"pointermove",41,660,200);
   assert.equal(left(),start+160,"Owner can continue moving its pin");
   cropPointer(app,pin,"pointerup",41,660,200);
   assert.equal(left(),start+160);
   assert.deepEqual(selectedClipboard(app),original,'Moving a pin does not alter its board objects');
   assert.deepEqual(['undo','redo'].map(key=>app.doc.querySelector(`[data-action="${key}"]`).disabled),history,'Pin movement preserves drawing undo and redo');
   const saved=point();
   assert.ok(Math.abs(saved[0]-before[0]-160/zoom)<1e-7);
   assert.ok(Math.abs(saved[1]-before[1])<1e-7);
   await app.click('[data-action="home"]');
   await app.click('[data-open]');
   app.doc.querySelector('#canvas').getBoundingClientRect=()=>({left:0,top:0,width:1200,height:900});
   app.w.dispatchEvent(new app.w.Event('resize'));
   await app.tick();
   pin=app.doc.querySelector(`[data-comment="${id}"]`);
   assert.ok(pin);
   const reopened=point();
   assert.ok(reopened.every((value,index)=>Math.abs(value-saved[index])<1e-7),'The owner position survives reopening');
   await app.click('[data-action="home"]');
  }finally{app.close();}
 });
