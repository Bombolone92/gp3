/**
 * First-run onboarding: one decision (set up / sample data / skip) and one
 * step (your first employee). Gated on an empty dataset; closing at any
 * point marks onboarding done so it never nags again. Sample data can be
 * wiped later from the banner the shell shows while it is installed.
 */
import { el } from '../lib/dom.js';
import { icon } from '../lib/icons.js';
import { openModal } from './modal.js';
import { toast } from './toast.js';
import { field, showFormError } from './components.js';
import { buildSeedData } from '../core/seed.js';

export function shouldOnboard(store) {
  const { settings, employees, shifts } = store.state;
  return !settings.onboarded && !settings.sampleData && employees.length === 0 && shifts.length === 0;
}

export function openOnboarding(store) {
  const body = el('div', { style: { display: 'contents' } });

  const markDone = () => {
    if (!store.state.settings.onboarded) {
      store.updateSettings({ onboarded: true }).catch(() => {});
    }
  };

  // Assigned once the dialog is opened, below. Every reference here runs
  // from an event handler, long after that.
  let modal;

  const skipButton = () =>
    el(
      'button',
      { class: 'btn btn-ghost btn-block', onClick: () => modal.close() },
      'Skip for now'
    );

  /* Step 0: welcome */
  function renderWelcome() {
    body.replaceChildren(
      el(
        'div',
        { class: 'onboard-hero' },
        el('img', { class: 'onboard-hero-icon', src: './icons/icon-192.png', width: 58, height: 58, alt: '' }),
        el('h3', {}, 'Your team, your cloud'),
        el(
          'p',
          {},
          'Plan schedules, approve swaps, and track attendance. Everything is stored in your own Puter account, never sold or shared.'
        )
      ),
      el('button', { class: 'btn btn-primary btn-block', onClick: renderFirstEmployee }, 'Set up my team'),
      el(
        'button',
        { class: 'btn btn-block btn-dashed', onClick: useSampleData },
        icon('sparkles', 15),
        'Explore with sample data'
      ),
      skipButton()
    );
  }

  async function useSampleData(e) {
    const button = e.currentTarget;
    button.disabled = true;
    try {
      await store.loadSampleData(buildSeedData());
    } catch (err) {
      console.error(err);
      toast('Couldn’t load the sample data. Check your connection.', 'error');
      button.disabled = false;
      return;
    }
    modal.close();
    toast('Sample data loaded. Wipe it anytime from the banner.');
  }

  /* Step 1: first employee, then the app takes over */
  function renderFirstEmployee() {
    const nameInput = el('input', { class: 'input', type: 'text', placeholder: 'Full name' });
    const roleInput = el('input', { class: 'input', type: 'text', placeholder: 'e.g. Barista, Server (optional)' });
    const errorBox = el('div', { style: { display: 'contents' } });

    body.replaceChildren(
      el(
        'div',
        { class: 'onboard-hero' },
        el('h3', {}, 'Add your first employee'),
        el('p', {}, 'Start with one person. The rest of the team, availability, and shifts can be added any time.')
      ),
      field('Name', nameInput),
      field('Role', roleInput),
      errorBox,
      el(
        'button',
        {
          class: 'btn btn-primary btn-block',
          onClick: async (e) => {
            errorBox.replaceChildren();
            const button = e.currentTarget;
            button.disabled = true;
            try {
              const employee = await store.addEmployee({ name: nameInput.value, role: roleInput.value });
              modal.close();
              toast(`${employee.name} added to your team`);
            } catch (err) {
              button.disabled = false;
              showFormError(errorBox, err.message);
            }
          },
        },
        'Start scheduling'
      ),
      skipButton()
    );
    nameInput.focus();
  }

  // Fill the body before opening: openModal() moves focus to the first
  // control it finds inside the dialog, and an empty one leaves focus on
  // <body>, outside the dialog a keyboard user was just handed.
  renderWelcome();
  modal = openModal({ title: 'Welcome', content: body, onClose: markDone });
}
