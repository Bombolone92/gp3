// @vitest-environment jsdom
/** Third review: opening and saving attachments. */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

vi.mock('../src/files.js', async (orig) => ({ ...(await orig()), fileUrl: async () => 'blob:source' }));

const { openAttachment, downloadAttachment } = await import('../src/views/common.js');

let made;
let revoked;
beforeEach(() => {
  made = [];
  revoked = [];
  let n = 0;
  URL.createObjectURL = () => {
    made.push(`blob:made-${++n}`);
    return made[made.length - 1];
  };
  URL.revokeObjectURL = (u) => revoked.push(u);
  vi.stubGlobal('fetch', async () => ({ blob: async () => new Blob(['%PDF-1.4']) }));
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('openAttachment', () => {
  it('releases the object URL of a PDF opened in a new tab once the tab has had time to load it', async () => {
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    await openAttachment({ name: 'Enrollment.pdf', type: 'application/pdf', path: 'students/x/Enrollment.pdf' });
    expect(open).toHaveBeenCalledWith(made[0], '_blank', 'noopener');
    // Not right away: the new tab (Safari especially) reads the URL after this returns.
    vi.advanceTimersByTime(1000);
    expect(revoked).toEqual([]);
    vi.advanceTimersByTime(60000);
    expect(revoked).toEqual([made[0]]);
  });
});

describe('downloadAttachment', () => {
  const saved = async (att) => {
    const names = [];
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function () {
      names.push(this.getAttribute('download'));
    });
    await downloadAttachment(att);
    return names;
  };

  it('saves a photo without a name as a photo with its extension', async () => {
    expect(await saved({ type: 'image/jpeg', path: 'activities/x/a' })).toEqual(['photo.jpg']);
    expect(await saved({ type: 'image/png', path: 'activities/x/b' })).toEqual(['photo.png']);
  });

  it('keeps a file name it has', async () => {
    expect(await saved({ name: 'Park day.jpg', type: 'image/jpeg', path: 'activities/x/c' })).toEqual(['Park day.jpg']);
  });
});
