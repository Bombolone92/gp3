/**
 * Publishing a read-only weekly schedule to a public link, backed by
 * Puter static hosting: the snapshot HTML is written to the app's cloud
 * storage and served from a per-user subdomain that is reused on update.
 */
import { el } from '../lib/dom.js';
import { icon } from '../lib/icons.js';
import { uid } from '../lib/id.js';
import { addDays, formatDate } from '../lib/time.js';
import { buildWeekSnapshot } from '../core/share.js';
import { isFiltered } from '../core/filters.js';
import { filterForSnapshot } from './schedule-filter.js';
import { openModal, confirmDialog } from './modal.js';
import { toast } from './toast.js';

const SHARE_DIR = 'schedule-share';

function shareUrl(subdomain) {
  return `https://${subdomain}.puter.site`;
}

async function writeSnapshot(store, weekStart, filter) {
  const html = buildWeekSnapshot(store.state, weekStart, { filter });
  await puter.fs.write(`${SHARE_DIR}/index.html`, html, { createMissingParents: true });
}

/** Publishes (or refreshes) the share site and returns its subdomain. */
async function publish(store, weekStart, filter) {
  await writeSnapshot(store, weekStart, filter);
  const existing = store.state.settings.shareSite;
  if (existing?.subdomain) return existing.subdomain;

  // Two attempts: the random suffix can, in principle, collide. The
  // suffix doubles as the link's only access control, so it comes from
  // uid() (crypto-backed) rather than the guessable Math.random().
  // Only the create is retried. Retrying the whole publish would answer
  // a failure to record the first site by standing up a second one, and
  // the first would stay live with nothing left pointing at it.
  let subdomain = null;
  for (let attempt = 0; subdomain === null; attempt += 1) {
    const candidate = `shifts-${uid()}`;
    try {
      const site = await puter.hosting.create(candidate, SHARE_DIR);
      subdomain = site?.subdomain ?? candidate;
    } catch (err) {
      if (attempt >= 1) throw err;
    }
  }

  try {
    await store.updateSettings({ shareSite: { subdomain } });
  } catch (err) {
    // The page is already public but unrecorded, so nothing in the app
    // could ever revoke it. Take it back down before reporting failure.
    await puter.hosting.delete(subdomain).catch(() => {});
    throw err;
  }
  return subdomain;
}

export function openShareDialog(ctx, weekStart) {
  const { store } = ctx;
  const body = el('div', { style: { display: 'contents' } });
  const weekLabel = `${formatDate(weekStart)} – ${formatDate(addDays(weekStart, 6))}`;
  // What is on screen is what gets published: the schedule's filter
  // travels with the snapshot, and the page it produces says so.
  const filter = filterForSnapshot(ctx.ui);
  const filterNote = isFiltered(filter)
    ? el(
        'div',
        { class: 'form-note' },
        icon('filter', 15),
        'The schedule is filtered, so the published page shows the same narrowed week and says so at the top. Clear the filter first to publish everyone.'
      )
    : null;

  function render() {
    const site = store.state.settings.shareSite;
    const puterAvailable = typeof globalThis.puter !== 'undefined' && globalThis.puter.hosting;

    if (!puterAvailable) {
      body.replaceChildren(
        el('div', { class: 'form-error' }, icon('circle-alert', 15), 'Sharing needs a signed-in Puter session.')
      );
      return;
    }

    if (!site?.subdomain) {
      body.replaceChildren(
        el(
          'p',
          { class: 'share-copy' },
          `Publishing creates a read-only page with the schedule for ${weekLabel}. Anyone with the link can view it; names and roles are included, attendance is not.`
        ),
        filterNote,
        el(
          'button',
          {
            class: 'btn btn-primary btn-block',
            onClick: async (e) => {
              const button = e.currentTarget;
              button.disabled = true;
              button.textContent = 'Publishing…';
              try {
                await publish(store, weekStart, filter);
                toast('Schedule published');
                render();
              } catch (err) {
                console.error(err);
                button.disabled = false;
                button.textContent = 'Publish public link';
                toast('Couldn’t publish. Check your connection.', 'error');
              }
            },
          },
          'Publish public link'
        )
      );
      return;
    }

    const url = shareUrl(site.subdomain);
    const linkInput = el('input', {
      class: 'input',
      type: 'text',
      readonly: true,
      'aria-label': 'Public link to the published schedule',
      value: url,
    });
    body.replaceChildren(
      el('p', { class: 'share-copy' }, 'Anyone with this link sees the last published week.'),
      filterNote,
      el(
        'div',
        { class: 'share-link-row' },
        linkInput,
        el(
          'button',
          {
            class: 'btn',
            onClick: async () => {
              try {
                await navigator.clipboard.writeText(url);
                toast('Link copied');
                return;
              } catch {
                /* no clipboard permission, or an insecure context */
              }
              // The fallback can fail too (execCommand returns false, or
              // is gone entirely). Saying "copied" either way leaves the
              // user pasting whatever was on the clipboard before.
              linkInput.focus();
              linkInput.select();
              let copied = false;
              try {
                copied = document.execCommand('copy');
              } catch {
                copied = false;
              }
              toast(
                copied ? 'Link copied' : 'Couldn’t copy automatically. The link is selected, so copy it.',
                copied ? 'success' : 'error'
              );
            },
          },
          icon('copy', 15),
          'Copy'
        )
      ),
      el(
        'button',
        {
          class: 'btn btn-primary btn-block',
          onClick: async (e) => {
            const button = e.currentTarget;
            const label = button.textContent;
            button.disabled = true;
            button.textContent = 'Updating…';
            try {
              await publish(store, weekStart, filter);
              toast(`Published the week of ${formatDate(weekStart)}`);
            } catch (err) {
              console.error(err);
              toast('Couldn’t update. Check your connection.', 'error');
            }
            button.textContent = label;
            button.disabled = false;
          },
        },
        `Update with this week (${weekLabel})`
      ),
      el(
        'button',
        {
          class: 'btn btn-danger btn-block',
          onClick: async () => {
            const ok = await confirmDialog({
              title: 'Stop sharing?',
              message: 'The public link stops working immediately. You can publish a new link any time.',
              confirmLabel: 'Stop sharing',
              danger: true,
            });
            if (!ok) return;
            try {
              await puter.hosting.delete(site.subdomain);
              await store.updateSettings({ shareSite: null });
              toast('Sharing stopped');
              render();
            } catch (err) {
              console.error(err);
              toast('Couldn’t stop sharing. Check your connection.', 'error');
            }
          },
        },
        'Stop sharing'
      )
    );
  }

  render();
  openModal({ title: 'Share schedule', content: body });
}
