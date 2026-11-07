/**
 * Writing help powered by Puter AI. Requests run with the signed-in agent's
 * own Puter account (user pays), and nothing is sent until the agent asks.
 */
import { h } from '../ui/dom.js';
import { openMenu } from '../ui/popover.js';
import { toast, toastError } from '../ui/toast.js';
import { escapeHtml, textToHtml } from '../shared/html.js';
import { sdk } from '../client/puter.js';

function textOf(res) {
  if (typeof res === 'string') return res;
  const c = res?.message?.content;
  if (typeof c === 'string') return c;
  if (Array.isArray(c)) return c.map((p) => p.text || '').join('');
  return String(res ?? '');
}

async function ask(system, user) {
  const p = sdk();
  if (!p?.ai?.chat) throw new Error('AI is not available here');
  const res = await p.ai.chat([
    { role: 'system', content: system },
    { role: 'user', content: user },
  ]);
  return textOf(res).trim().replace(/\u2014/g, ', ');
}

const STYLE = 'Write in plain, warm, professional language. Do not use emojis or em dashes. Do not invent facts, prices, links or promises that are not in the conversation.';

export async function aiSummary({ subject, conversation }) {
  return ask(
    `You summarize customer support tickets for agents. Reply with 2 to 4 short sentences: the customer's problem, what has been tried, and what is still needed. ${STYLE}`,
    `Subject: ${subject}\n\nConversation:\n${conversation}`,
  );
}

const ACTIONS = [
  { id: 'draft', label: 'Draft a reply', needsText: false },
  { id: 'improve', label: 'Improve writing', needsText: true },
  { id: 'friendly', label: 'Make it friendlier', needsText: true },
  { id: 'formal', label: 'Make it more formal', needsText: true },
  { id: 'shorter', label: 'Make it shorter', needsText: true },
  { id: 'fix', label: 'Fix spelling and grammar', needsText: true },
];

export function aiAssist({ anchor, editor, subject, conversation, requester, agent, articles, internal }) {
  const hasText = !editor.isEmpty();
  openMenu(anchor, [
    { heading: 'Writing assistant' },
    ...ACTIONS.map((a) => ({
      label: a.label,
      disabled: a.needsText && !hasText,
      run: () => runAction(a.id),
    })),
  ], { label: 'Writing assistant' });

  async function runAction(id) {
    const current = editor.getText();
    const busy = toast('Writing with AI', { persistent: true });
    // Typing during the request would be overwritten by the result.
    editor.setBusy(true);
    try {
      let out;
      if (id === 'draft') {
        const kb = articles.slice(0, 30).map((a) => `- ${a.title}: ${a.excerpt || ''}`).join('\n');
        out = await ask(
          `You are a support agent named ${agent?.name || 'the agent'} writing ${internal ? 'an internal note for teammates' : `a reply to the customer${requester?.name ? ` ${requester.name}` : ''}`}. ${STYLE} Greet the customer by first name, answer what they asked, and end with a short sign-off with the agent's first name. Use the help articles only if they apply. Return only the message text.`,
          `Subject: ${subject}\n\nConversation so far:\n${conversation() || '(no messages yet)'}\n\nHelp articles:\n${kb || '(none)'}\n\n${current ? `Notes from the agent to include:\n${current}` : ''}`,
        );
      } else {
        const how = {
          improve: 'Improve the clarity and flow of this support message while keeping its meaning.',
          friendly: 'Rewrite this support message to sound warmer and friendlier, keeping its meaning.',
          formal: 'Rewrite this support message to sound more formal and polished, keeping its meaning.',
          shorter: 'Make this support message shorter and more direct, keeping every important point.',
          fix: 'Fix spelling, grammar and punctuation in this support message. Change nothing else.',
        }[id];
        out = await ask(`${how} ${STYLE} Return only the rewritten message.`, current);
      }
      editor.setBusy(false);
      editor.replaceHtml(textToHtml(out));
      toast('AI suggestion inserted. Review it before sending.', { kind: 'success' });
    } catch (e) {
      toastError(e, 'The writing assistant is not available right now');
    } finally {
      busy.close();
      editor.setBusy(false);
    }
  }
}

export { h, escapeHtml };
