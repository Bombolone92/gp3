import { buildMessage } from './compose.js';
import { dayFolder, mailFilename } from './mailbox.js';

const MESSAGES = [
  ['Amelia Chen', 'amelia', 'The autumn launch is ready for review', 'The new brand direction is ready. The team has brought together the landing page, launch notes and social concepts. Take a look before our studio review tomorrow.'],
  ['Daniel Kim', 'daniel', 'Website preview: the final details', 'The responsive layouts are in place. We improved keyboard navigation, tightened the loading states and polished the mobile menu. The preview is ready for a final walkthrough.'],
  ['Lila Patel', 'lila', 'What we learned from five customer conversations', 'Three themes stood out: clearer onboarding, a simpler dashboard and faster access to recent work. I have grouped the interview notes into opportunities for our next planning session.'],
  ['Grace Okafor', 'grace', 'Launch checklist and campaign calendar', 'Our launch checklist is attached. Creative is approved, the newsletter is drafted and the partner kit is ready for review. Please check your workstream before the Friday demo.'],
  ['Ben Carter', 'ben', 'Re: The autumn launch is ready for review', 'The flow looks great. I suggest leading with the new workspace view and moving the detailed feature list below the customer story. That will give the opening a clearer focus.'],
  ['Amelia Chen', 'amelia', 'Re: The autumn launch is ready for review', 'Agreed. I have updated the opening and added a quieter background to the product section. Let’s use this version for the studio presentation.'],
  ['Isabel Reyes', 'isabel', 'Your week at Northwind Studio', 'Monday: planning and focus time. Wednesday: product walkthrough. Friday: team demo and coffee. The shared studio is available all week for project work.'],
  ['Sofia Andersson', 'sofia', 'Materials for the studio workshop', 'I have prepared the moodboards, paper samples and workshop prompts. We will explore three directions, then choose one to develop together.'],
  ['Marco Costa', 'marco', 'Partner spotlight: Forma House', 'We would love to feature your studio process in our next partner spotlight. A short conversation about the project and a few design sketches would make a thoughtful story.'],
  ['Nora Bennett', 'nora', 'Illustration direction for the fieldnotes', 'The warm palette and simple shapes are working well with the typography. I will refine the opening illustration and share the next round after the critique.'],
  ['Felix Weber', 'felix', 'Photography session: shot list', 'The shot list includes the entrance, shared table, quiet corners and material details. Morning light will suit the studio best, so I suggest starting at nine.'],
  ['Priya Shah', 'priya', 'A few ideas for the next chapter', 'The next chapter could focus on how small teams stay connected as they grow. Let’s start with a short field guide and test it with our community.'],
  ['James Wilson', 'james', 'The Sunday Journal: a slower kind of workspace', 'This week we are exploring spaces that make room for concentration and conversation. Your studio concept would be a lovely addition to the design issue.'],
  ['Chloe Martin', 'chloe', 'Brand toolkit handoff', 'The toolkit includes the color palette, type scale, spacing rules and examples for everyday use. The goal is to make future work consistent without making it feel repetitive.'],
  ['Owen Brooks', 'owen', 'Studio showcase: run of show', 'We will open with the project story, walk through the prototype and finish with questions. Each speaker has five minutes, with a short break before the discussion.'],
  ['Theo Laurent', 'theo', 'Thanks for a thoughtful workshop', 'Thank you for making the session so welcoming. The team left with a clear direction and a practical next step. Looking forward to seeing the first prototype.'],
];

/** Real MIME files, fictional people, and no delivery API. */
export function sampleMessages(now = new Date()) {
  const batch = crypto.randomUUID();
  const rootId = `<${batch}.0@northwind.example>`;
  return MESSAGES.map(([name, sender, subject, text], i) => {
    // Keep the thread root older than both replies, and every message in the past.
    const hoursAgo = i === 0 ? 6 : i === 4 ? 2 : i === 5 ? 1 : i * 7 + 1;
    const date = new Date(now.getTime() - hoursAgo * 3_600_000);
    const reply = i === 4 || i === 5;
    const body = `Hi there,\n\n${text}\n\n${name}\nNorthwind Studio\n\nFictional sample message created for an app demo. No email was sent.`;
    const attachments = i === 3 ? [{
      filename: 'launch-checklist.csv', type: 'text/csv',
      bytes: new TextEncoder().encode('workstream,owner,status\nCreative,Amelia Chen,Approved\nWebsite,Daniel Kim,In review\nCampaign,Grace Okafor,Ready\n'),
    }] : [];
    return {
      subject, date,
      raw: buildMessage({
        from: `${name} <${sender}@northwind.example>`, to: ['Studio Team <demo@northwind.example>'],
        subject, body, date, messageId: `<${batch}.${i}@northwind.example>`,
        inReplyTo: reply ? rootId : '', references: reply ? [rootId] : [], attachments,
        html: i === 6 ? '<h2>Your week at Northwind Studio</h2><p>Room to focus. Time to connect.</p><ul><li>Monday: weekly planning</li><li>Wednesday: product walkthrough</li><li>Friday: team demo and coffee</li></ul><p>Fictional sample newsletter. No email was sent.</p>' : '',
      }),
    };
  });
}

export function createSampleDataPopulator(getSession) {
  let pending = null;
  return function populateSampleData() {
    if (!pending) pending = Promise.resolve().then(async () => {
      const session = getSession();
      if (!session) throw new Error('Sign in and wait for Email to finish loading before populating sample data.');
      const { fs, mailPath, app } = session;
      const paths = [];
      try {
        for (const { subject, date, raw } of sampleMessages()) {
          if (getSession() !== session) throw new Error('The Email session changed.');
          const path = `${mailPath}/objects/${dayFolder(date)}/${mailFilename(subject, date)}`;
          await app.mailWrite(() => fs.write(path, new Blob([raw], { type: 'message/rfc822' }), {
            createMissingParents: true, overwrite: false,
          }));
          paths.push(path);
        }
      } catch (cause) {
        throw new Error(`Sample data stopped after ${paths.length} messages were saved. Those messages remain in your inbox.`, { cause });
      }
      if (getSession() === session) await app.refreshInbox();
      return { created: paths.length, paths };
    }).finally(() => { pending = null; });
    return pending;
  };
}
