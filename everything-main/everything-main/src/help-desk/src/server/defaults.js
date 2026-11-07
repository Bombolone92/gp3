/**
 * What a new help desk starts with: one group, a few macros, the standard
 * notification triggers, service level targets and a help center outline.
 * Everything here can be edited or removed in Admin.
 */
import { randomId } from '../shared/ids.js';
import { DEFAULT_SLA } from '../shared/rules.js';

export function defaultConfig() {
  const general = randomId(8);
  const start = randomId(8);
  const faq = randomId(8);
  return {
    groups: [{ id: 'support', name: 'Support', desc: 'Everyone who answers requests' }],
    fields: [],
    views: [],
    sla: structuredClone(DEFAULT_SLA),
    kb: {
      categories: [{ id: general, name: 'General', desc: 'Basics and frequently asked questions', order: 0 }],
      sections: [
        { id: start, categoryId: general, name: 'Getting started', order: 0 },
        { id: faq, categoryId: general, name: 'Frequently asked questions', order: 1 },
      ],
    },
    macros: [
      {
        id: randomId(8),
        title: 'Ask for more details',
        active: true,
        actions: [{ field: 'status', value: 'pending' }],
        comment: {
          public: true,
          html: '<p>Hi {{requester.first_name}},</p><p>Thanks for reaching out. Could you share a few more details, such as the steps you took and any error message you saw? That will help us find the cause quickly.</p><p>Best,<br>{{agent.first_name}}</p>',
        },
      },
      {
        id: randomId(8),
        title: 'Close and thank',
        active: true,
        actions: [{ field: 'status', value: 'solved' }],
        comment: {
          public: true,
          html: '<p>Hi {{requester.first_name}},</p><p>Glad we could help. I am marking this request as solved. If anything else comes up, just reply and we will pick it up again.</p><p>Best,<br>{{agent.first_name}}</p>',
        },
      },
      {
        id: randomId(8),
        title: 'Escalate to urgent',
        active: true,
        actions: [{ field: 'priority', value: 'urgent' }, { field: 'add_tags', value: 'escalated' }],
        comment: { public: false, html: '<p>Escalated. Needs attention today.</p>' },
      },
    ],
    triggers: [
      {
        id: randomId(8),
        title: 'Confirm new requests to the requester',
        active: true,
        event: 'created',
        conditions: { all: [{ field: 'actor', op: 'is', value: 'customer' }], any: [] },
        actions: [
          {
            field: 'notify_requester',
            // No text from the request is repeated here: anyone can submit the
            // form with any address, so this mail must not carry their words.
            subject: 'We received your request',
            body: 'Hello,\n\nThanks for contacting {{desk.name}}. Your request has been received and an agent will reply soon. You can follow it at the link below.',
          },
        ],
      },
      {
        id: randomId(8),
        title: 'Email the requester about public replies',
        active: true,
        event: 'any',
        conditions: { all: [{ field: 'actor', op: 'is', value: 'agent' }, { field: 'comment', op: 'is', value: 'public' }], any: [] },
        actions: [{ field: 'notify_requester', subject: 'Re: {{ticket.subject}}', body: '{{comment.text}}' }],
      },
      {
        id: randomId(8),
        title: 'Tag urgent words',
        active: false,
        event: 'created',
        conditions: { all: [], any: [{ field: 'subject', op: 'contains', value: 'urgent' }, { field: 'subject', op: 'contains', value: 'outage' }] },
        actions: [{ field: 'priority', value: 'urgent' }, { field: 'add_tags', value: 'urgent_words' }],
      },
    ],
  };
}

export const CONFIG_KINDS = ['groups', 'macros', 'views', 'fields', 'triggers', 'sla', 'kb'];
