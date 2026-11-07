for (const change of ["viewer", "board"])
  test(`comment pin owner release cannot write after a ${change} change`, () => {
    const a = commentPinFixture();
    try {
      const original = structuredClone(a.s.board.comments);
      a.event("pointerdown", 41);
      a.event("pointermove", 41, 140, 50);
      if (change === "viewer") a.s.readOnly = true;
      else a.s.board = { ...structuredClone(a.s.board), id: "another-board" };
      a.event("pointercancel", 42, 140, 50);
      a.event("pointerup", 41, 140, 50);
      a.event("lostpointercapture", 41, 140, 50);
      assert.equal(a.saves(), 0, "Stale or read-only release cannot persist a position");
      assert.deepEqual(a.s.board.comments, original);
      assert.equal(a.pin.style.left, "40px");
      assert.equal(a.pin.style.top, "50px");
    } finally { a.close(); }
  });
