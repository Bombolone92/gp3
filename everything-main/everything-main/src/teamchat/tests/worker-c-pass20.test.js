/**
 * Twentieth review pass, region C: integrations, export/import/transfer,
 * files, link previews, search, the email worker and their client-side
 * counterparts. Each test here reproduces a defect found in that pass and
 * proves the fix.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { boot, as, USERS, workspaceWith } from './helpers/harness.js';

const { alice, bob } = USERS;
let rt;

beforeEach(async () => {
  rt = await boot();
});

/** A webhook into `general`, as an admin makes one; resolves to its token. */
async function webhookFor(wsId, general) {
  const made = await as(alice).post(`/api/ws/${wsId}/webhooks`, { channel: general.id, name: 'CI' });
  expect(made.status).toBe(200);
  return made.data.token;
}

describe('a webhook payload whose blocks carry only blank text', () => {
  it('posts the text beside them, as it does for a divider or a picture, rather than refusing the notice as saying nothing', async () => {
    const { wsId, general } = await workspaceWith(alice, [bob]);
    const token = await webhookFor(wsId, general);
    // A section whose text is a space or a line break, a context line of blank
    // pieces, a section whose fields are blank: none says anything, and the
    // summary line beside them is the notice.
    const cases = [
      { text: 'Deploy finished', blocks: [{ type: 'section', text: { type: 'mrkdwn', text: ' ' } }] },
      { text: 'Deploy finished', blocks: [{ type: 'section', text: { type: 'mrkdwn', text: '\n\n' } }] },
      { text: 'Deploy finished', blocks: [{ type: 'context', elements: [{ type: 'mrkdwn', text: ' ' }, { type: 'plain_text', text: '\t' }] }] },
      { text: 'Deploy finished', blocks: [{ type: 'section', fields: [{ type: 'mrkdwn', text: ' ' }] }] },
    ];
    for (const body of cases) {
      const res = await as(null).post(`/webhook/${token}`, body);
      expect([res.status, res.data.text]).toEqual([200, 'Deploy finished']);
    }
    // A blank block beside an attachment leaves the attachment to speak, and one beside nothing is still refused.
    const withAttachment = await as(null).post(`/webhook/${token}`, { blocks: [{ type: 'section', text: { type: 'mrkdwn', text: ' ' } }], attachments: [{ text: 'Build 42 passed' }] });
    expect([withAttachment.status, withAttachment.data.text]).toEqual([200, 'Build 42 passed']);
    const nothing = await as(null).post(`/webhook/${token}`, { blocks: [{ type: 'section', text: { type: 'mrkdwn', text: ' ' } }] });
    expect(nothing.status).toBe(400);
  });
});
