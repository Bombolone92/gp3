// Chromium reports cached/conditional FontFace reads as request events too.
// Retain every read, but count actual successful network bodies separately.
export async function recordFontTransfers(page, pattern) {
  const session = await page.context().newCDPSession(page), records = new Map();
  session.on('Network.requestWillBeSent', e => {
    if (pattern.test(e.request.url)) records.set(e.requestId, { url: e.request.url, type: e.type, cached: false });
  });
  session.on('Network.requestServedFromCache', e => { const row = records.get(e.requestId); if (row) row.cached = true; });
  session.on('Network.responseReceived', e => {
    const row = records.get(e.requestId);
    if (row) { row.status = e.response.status; row.cached ||= !!(e.response.fromDiskCache || e.response.fromPrefetchCache); }
  });
  session.on('Network.responseReceivedExtraInfo', e => { const row = records.get(e.requestId); if (row) row.wireStatus = e.statusCode; });
  session.on('Network.loadingFinished', e => { const row = records.get(e.requestId); if (row) row.encodedDataLength = e.encodedDataLength; });
  await session.send('Network.enable');
  return {
    records: () => [...records.values()],
    downloads: () => [...records.values()].filter(row => row.type === 'Font' && !row.cached && (row.wireStatus ?? row.status) === 200),
    close: () => session.detach(),
  };
}
