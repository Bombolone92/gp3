// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import landingHTML from '../src/views/landing.html?raw';

const mocks = vi.hoisted(() => ({ init: vi.fn(), mountShell: vi.fn(), loadRestorePoints: vi.fn(), companies: [], activeCompanyId: null }));
vi.mock('../src/lib/store.js', () => ({
  store: {
    init: mocks.init, settings: {}, company: { currency: 'USD' }, recoveredHolders: [],
    addEventListener: vi.fn(), isStale: false, unsaved: false,
    // What the recovery screen reads of a store whose load failed.
    get companies() { return mocks.companies; },
    get activeCompanyId() { return mocks.activeCompanyId; },
    loadRestorePoints: (...args) => mocks.loadRestorePoints(...args),
  },
  Store: { prepareImport: vi.fn() },
  isRefusal: () => false,
}));
vi.mock('../src/ui/shell.js', () => ({ mountShell: mocks.mountShell }));
vi.mock('../src/ui/onboarding.js', () => ({ shouldOnboard: () => false, openOnboarding: vi.fn() }));
vi.mock('../src/ui/theme.js', () => ({ applyTheme: vi.fn() }));
vi.mock('../src/ui/toast.js', () => ({ bottomStack: () => document.body, toast: vi.fn() }));

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  // The production HTML contains the landing before the session is checked.
  document.body.innerHTML = `<div id="app"><div id="landing-top" class="landing">${landingHTML}</div></div>`;
  history.replaceState(null, '', '/');
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
  mocks.init.mockResolvedValue();
  mocks.companies = [];
  mocks.activeCompanyId = null;
  mocks.loadRestorePoints.mockResolvedValue([]);
  mocks.mountShell.mockImplementation((root) => { root.textContent = 'App workspace'; });
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

async function start(puter) {
  vi.stubGlobal('puter', puter);
  await import('../src/main.js');
  await vi.waitFor(() => expect(document.getElementById('app').textContent.length).toBeGreaterThan(0));
}

describe('landing visibility at startup', () => {
  it('keeps navigation usable while the SDK loads and initializes sign-in only once', async () => {
    const sdk = document.createElement('script');
    sdk.dataset.puterSdk = '';
    document.body.append(sdk);
    await start(undefined);
    const view = document.querySelector('.landing');
    const button = view.querySelector('[data-sign-in]');
    expect(button.disabled).toBe(true);
    const toggle = view.querySelector('.lp-nav-toggle');
    toggle.click();
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    const signIn = vi.fn().mockResolvedValue();
    vi.stubGlobal('puter', { env: 'web', auth: { isSignedIn: () => false, signIn } });
    sdk.dispatchEvent(new Event('load'));
    await vi.waitFor(() => expect(button.disabled).toBe(false));
    button.click();
    await vi.waitFor(() => expect(mocks.mountShell).toHaveBeenCalledTimes(1));
    expect(signIn).toHaveBeenCalledTimes(1);
  });

  it('recovers when an asynchronous SDK request fails', async () => {
    const sdk = document.createElement('script');
    sdk.dataset.puterSdk = '';
    document.body.append(sdk);
    await start(undefined);
    sdk.dispatchEvent(new Event('error'));
    const button = document.querySelector('[data-sign-in]');
    await vi.waitFor(() => expect(button.disabled).toBe(false));
    button.click();
    expect(document.querySelector('[role="status"]').textContent).toContain('Couldn’t connect to Puter');
    expect(mocks.init).not.toHaveBeenCalled();
  });

  it('shows the landing only to signed-out web visitors without reading their data', async () => {
    await start({ env: 'web', auth: { isSignedIn: () => false } });
    expect(document.querySelector('.landing')).not.toBeNull();
    expect(document.querySelector('.landing').dataset.ready).toBe('true');
    expect(document.querySelectorAll('h1')).toHaveLength(1);
    expect(mocks.init).not.toHaveBeenCalled();
    expect(mocks.mountShell).not.toHaveBeenCalled();
  });

  it('boots directly for a signed-in web visitor and preserves an app route', async () => {
    history.replaceState(null, '', '/#/stakeholders');
    await start({ env: 'web', auth: { isSignedIn: () => Promise.resolve(true) } });
    await vi.waitFor(() => expect(mocks.mountShell).toHaveBeenCalledTimes(1));
    expect(document.querySelector('.landing')).toBeNull();
    expect(location.hash).toBe('#/stakeholders');
  });

  it('says what the sanitizers refused at boot, in their own words', async () => {
    mocks.init.mockRejectedValue(Object.assign(new Error('Financing assumptions: unsupported field extra.'), { name: 'FinancingError', refused: true }));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    await start({ env: 'web', auth: { isSignedIn: () => Promise.resolve(true) } });
    await vi.waitFor(() => expect(document.getElementById('app').textContent).toContain('Couldn’t read your saved data'));
    const text = document.getElementById('app').textContent;
    expect(text).toContain('Financing assumptions: unsupported field extra.');
    expect(text).not.toContain('Check your connection');
    expect(mocks.mountShell).not.toHaveBeenCalled();
  });

  it('offers the ways back when a record is unreadable at boot', async () => {
    mocks.init.mockRejectedValue(Object.assign(new Error('The data stored at captable:a:securities:v1 could not be read.'), { name: 'CorruptDataError' }));
    mocks.companies = [{ id: 'a', label: 'Acme', createdAt: 1 }, { id: 'b', label: 'Beta', createdAt: 2 }];
    mocks.activeCompanyId = 'a';
    mocks.loadRestorePoints.mockResolvedValue([{ id: 'p', at: Date.now(), label: 'Before importing a backup',
      data: { stakeholders: [{}], securities: [{}, {}] } }]);
    vi.spyOn(console, 'error').mockImplementation(() => {});
    await start({ env: 'web', auth: { isSignedIn: () => Promise.resolve(true) } });
    const app = document.getElementById('app');
    await vi.waitFor(() => expect(app.textContent).toContain('Couldn’t read your saved data'));
    expect(app.textContent).toContain('Nothing has been changed. Try again, or use one of the ways back below.');
    await vi.waitFor(() => expect(app.textContent).toContain('Before importing a backup'));
    expect([...app.querySelectorAll('button')].map((b) => b.textContent.trim())).toEqual(['Try again', 'Restore', 'Choose file', 'Open']);
    expect(app.textContent).toContain('1 holder · 2 securities');
    expect(app.textContent).toContain('Beta');
    expect(mocks.mountShell).not.toHaveBeenCalled();
  });

  it('offers only a retry when the list of companies itself is unreadable', async () => {
    mocks.init.mockRejectedValue(Object.assign(new Error('The data stored at captable:companies:v1 could not be read.'), { name: 'CorruptDataError' }));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    await start({ env: 'web', auth: { isSignedIn: () => Promise.resolve(true) } });
    const app = document.getElementById('app');
    await vi.waitFor(() => expect(app.textContent).toContain('Couldn’t read your saved data'));
    expect(app.textContent).toContain('Nothing has been changed. Try again.');
    expect(app.textContent).not.toContain('Ways back');
    expect([...app.querySelectorAll('button')].map((b) => b.textContent.trim())).toEqual(['Try again']);
    expect(mocks.loadRestorePoints).not.toHaveBeenCalled();
  });

  it.each([false, true])('boots inside Puter even when web auth is %s', async (signedIn) => {
    const isSignedIn = vi.fn(() => signedIn);
    await start({ env: 'app', auth: { isSignedIn } });
    await vi.waitFor(() => expect(mocks.mountShell).toHaveBeenCalledTimes(1));
    expect(document.querySelector('.landing')).toBeNull();
    expect(isSignedIn).not.toHaveBeenCalled();
  });

  it('shows the introduction when the SDK or web session check is unavailable', async () => {
    await start(undefined);
    expect(document.querySelector('.landing')).not.toBeNull();
    expect(mocks.init).not.toHaveBeenCalled();
  });

  it('handles a failing web session check', async () => {
    await start({ env: 'web', auth: { isSignedIn: () => { throw new Error('Unavailable'); } } });
    expect(document.querySelector('.landing')).not.toBeNull();
    expect(mocks.init).not.toHaveBeenCalled();
  });

  it('transitions from a landing anchor to the workspace after sign-in', async () => {
    history.replaceState(null, '', '/?source=web#faq');
    await start({ env: 'web', auth: { isSignedIn: () => false, signIn: vi.fn().mockResolvedValue() } });
    document.querySelector('[data-sign-in]').click();
    await vi.waitFor(() => expect(mocks.mountShell).toHaveBeenCalledTimes(1));
    expect(document.querySelector('.landing')).toBeNull();
    expect(location.hash).toBe('');
    expect(location.search).toBe('?source=web');
    expect(window.scrollTo).toHaveBeenCalledWith(0, 0);
  });
});
