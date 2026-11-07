# Dense connection sites native reference

Original OPC/XML from tools/canvas_dense_sites_fixture.py, reusing our original
rectangle fixture. It contains 16,384 connection sites and two guides. The
reference application opened the exact source and exported native.pdf without saving changes.
The reference extractor records the source SHA-256 and eleven ink cross-sections.

Connection sites do not paint extra ink. Browser tests compare the rectangle
with the reference application within 0.75pt, check editable import, edit/export/reopen, preserve the
entire connection-site XML list, and compare every ZIP entry after undo. Invalid
late sites (unknown guide or missing position) must still reject editable import.

Part 1 Annex A.4.1 CT_ConnectionSiteList permits unbounded cxn elements. The old
10,000 cutoff incorrectly rejected this fixture. The fix removes that cutoff
without adding connector rerouting or editing connection sites.
