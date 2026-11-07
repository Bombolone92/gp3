
function commentPinFixture() {
  const a = setup();
  a.s.board.comments = [commentThread({x:40,y:50},a.s.author,"Review")];
  a.ui.render();
  const pin = a.doc.querySelector("[data-comment]");
  return {...a,pin,event(type,id,x=40,y=50) {
    const e = new a.dom.window.MouseEvent(type,{button:0,clientX:x,clientY:y,bubbles:true,cancelable:true,detail:type==="click"?1:0});
    Object.defineProperty(e,"pointerId",{value:id});pin.dispatchEvent(e);
  }};
}
for (const foreign of ["pointerdown","pointermove","pointerup","pointercancel","lostpointercapture","click"])
  test(`comment pin moves retain their owner through another pointer's ${foreign}`, () => {
    const a = commentPinFixture();
    try {
      a.event("pointerdown",41);
      a.event("pointermove",41,140,50);
      a.event(foreign,42,140,50);
      assert.equal(a.pin.style.left,"140px","Foreign events preserve the owner preview");
      assert.equal(a.doc.querySelector("#comments-panel"),null,"A second pointer cannot open the discussion during the move");
      assert.equal(a.saves(),0);
      a.event("pointermove",41,180,70);
      assert.equal(a.pin.style.left,"180px");
      assert.equal(a.pin.style.top,"70px");
      a.event("pointerup",41,180,70);
      a.event("lostpointercapture",41,180,70);
      assert.equal(a.saves(),1,"Only the owner's release saves the position once");
      assert.equal(a.s.board.comments[0].x,180);
      assert.equal(a.s.board.comments[0].y,70);
    } finally { a.close(); }
  });
for (const ending of ["pointercancel","lostpointercapture"])
  test(`comment pin owner ${ending} rolls back without a write and retains ordinary clicks`, () => {
    const a=commentPinFixture();
    try {
      a.event("pointerdown",41);a.event("pointermove",41,140,50);a.event(ending,41,140,50);
      a.event("pointerup",41,140,50);
      assert.equal(a.pin.style.left,"40px");assert.equal(a.saves(),0);
      a.event("pointerdown",43);a.event("pointerup",43);a.event("click",43);
      assert.ok(a.doc.querySelector("#comments-panel"));assert.equal(a.saves(),0);
    }finally{a.close();}
  });

test("a different comment pin cannot take over an owned move or open its discussion", () => {
  const a = commentPinFixture();
  try {
    const firstId = a.s.board.comments[0].id;
    const second = commentThread({x:300,y:200},a.s.author,"Second review");
    a.s.board.comments.push(second);a.ui.render();
    const other=a.doc.querySelector(`[data-comment="${second.id}"]`);
    const foreign = (type) => {
      const e=new a.dom.window.MouseEvent(type,{button:0,clientX:300,clientY:200,bubbles:true,cancelable:true,detail:type==='click'?1:0});
      Object.defineProperty(e,'pointerId',{value:42});other.dispatchEvent(e);
    };
    a.event('pointerdown',41);a.event('pointermove',41,140,50);
    foreign('pointerdown');foreign('pointerup');foreign('click');
    assert.equal(a.doc.querySelector('#comments-panel'),null);
    assert.equal(a.pin.style.left,'140px');assert.equal(other.style.left,'300px');
    a.event('pointermove',41,180,70);a.event('pointerup',41,180,70);
    assert.equal(a.saves(),1);
    const stored=a.s.board.comments.find(c=>c.id===firstId);
    assert.equal(stored.x,180);assert.equal(stored.y,70);
    assert.deepEqual(a.s.board.comments.find(c=>c.id===second.id),second);
  }finally{a.close();}
});
