/** First run in a new account: name the school and choose an empty start or sample data. */
import { h } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { openDialog } from '../ui/dialog.js';
import { field, textInput } from '../ui/components.js';
import { toast } from '../ui/toast.js';
import { navigate } from '../ui/router.js';
import { app } from '../app.js';
import { ROOM_COLORS } from '../core/people.js';

export function maybeOnboard() {
  const store = app.store;
  const check = () => {
    if (!store.state.synced) return false;
    if (store.state.settings.onboarded || !store.state.remoteEmpty || store.all('students').length) return true;
    show();
    return true;
  };
  if (!check()) {
    const off = store.subscribe(() => check() && off());
  }
}

function show() {
  const store = app.store;
  const name = textInput({ placeholder: 'Sunny Days Early Learning', autocomplete: 'organization' });
  const rooms = textInput({ value: 'Infants, Toddlers, Preschool', placeholder: 'Infants, Toddlers, Preschool' });
  let done = false;
  openDialog({
    title: 'Welcome! Let\'s set up your school',
    body: h(
      'div.stack',
      h('p', 'Two quick things and you are ready to check children in. You can change all of this later in Settings.'),
      field('School name', name),
      field('Rooms', rooms, { hint: 'Separate with commas. Set capacity and ratios later on the Rooms page.' }),
    ),
    footer: ({ close }) => [
      h(
        'button.btn.ghost',
        {
          type: 'button',
          onClick: async () => {
            done = true;
            close();
            const { buildSampleData } = await import('../core/sample.js');
            const sample = buildSampleData(app.today());
            for (const [n, list] of Object.entries(sample.collections)) store.bulkPut(n, list);
            store.saveSettings({ ...sample.settings, onboarded: true });
            toast('Sample school loaded. Explore, then replace it with your own.');
            navigate('/');
          },
        },
        icon('sprout', 16),
        'Use sample data',
      ),
      h('span.spacer'),
      h(
        'button.btn.primary',
        {
          type: 'button',
          onClick: () => {
            done = true;
            const list = rooms.value.split(',').map((r) => r.trim()).filter(Boolean);
            store.bulkPut('rooms', list.map((r, i) => ({ name: r, order: i, color: ROOM_COLORS[i % ROOM_COLORS.length], ratio: 0, capacity: 0 })));
            store.saveSettings({ school: { name: name.value.trim() }, onboarded: true });
            close();
            toast('Your school is ready. Add your first child next.');
            navigate('/children/new');
          },
        },
        'Get started',
      ),
    ],
    onClose: () => !done && store.saveSettings({ onboarded: true }),
  });
}
