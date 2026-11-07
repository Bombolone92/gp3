/**
 * First-run onboarding: one decision (set up / sample data / skip) and one
 * step (company name + first job). Gated on an empty dataset; closing at
 * any point marks onboarding done so it never nags again. Sample data can
 * be wiped later from the banner the shell shows while it is installed.
 */
import { el } from '../lib/dom.js';
import { icon } from '../lib/icons.js';
import { openModal } from './modal.js';
import { toast } from './toast.js';
import { brandMark, field } from './components.js';
import { buildSeedData } from '../core/seed.js';

export function shouldOnboard(store) {
  const { settings, jobs, candidates } = store.state;
  return !settings.onboarded && !settings.sampleData && jobs.length === 0 && candidates.length === 0;
}

export function openOnboarding(store, ctx = null) {
  const body = el('div', { style: { display: 'contents' } });

  const markDone = () => {
    if (!store.state.settings.onboarded) {
      store.updateSettings({ onboarded: true }).catch(() => {});
    }
  };
  const modal = openModal({ title: 'Welcome', content: body, onClose: markDone });

  const skipButton = () =>
    el('button', { class: 'btn btn-ghost btn-block', onClick: () => modal.close() }, 'Skip for now');

  /* Step 0: welcome */
  function renderWelcome() {
    body.replaceChildren(
      el(
        'div',
        { class: 'onboard-hero' },
        el('div', { class: 'onboard-hero-icon' }, brandMark(58)),
        el('h3', {}, 'Hiring, in one place'),
        el(
          'p',
          {},
          'Job pages, a candidate pipeline, interviews, scorecards, offers, and onboarding. Everything is stored in your own Puter account, never sold or shared.'
        )
      ),
      el('button', { class: 'btn btn-primary btn-block', onClick: renderSetup }, 'Set up my hiring'),
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

  /* Step 1: company + first job, then the app takes over */
  function renderSetup() {
    const company = el('input', { class: 'input', type: 'text', placeholder: 'Shown on offer letters' });
    const title = el('input', { class: 'input', type: 'text', placeholder: 'e.g. Senior Frontend Engineer' });
    const department = el('input', { class: 'input', type: 'text', placeholder: 'e.g. Engineering (optional)' });
    const errorBox = el('div', { style: { display: 'contents' } });

    body.replaceChildren(
      el(
        'div',
        { class: 'onboard-hero' },
        el('h3', {}, 'Create your first job'),
        el('p', {}, 'A job posting is where candidates, interviews, and offers live. You can add more any time.')
      ),
      field('Company name', company, 'ob-company'),
      field('Job title', title, 'ob-title'),
      field('Department', department, 'ob-department'),
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
              if (company.value.trim()) {
                await store.updateSettings({ companyName: company.value.trim() });
              }
              const job = await store.addJob({ title: title.value, department: department.value });
              modal.close();
              toast(`“${job.title}” is open. Add your first candidate`);
              ctx?.navigate(`jobs/${job.id}`);
            } catch (err) {
              button.disabled = false;
              errorBox.appendChild(el('div', { class: 'form-error' }, icon('circle-alert', 15), err.message));
            }
          },
        },
        'Start hiring'
      ),
      skipButton()
    );
    company.focus();
  }

  renderWelcome();
}
