import { describe, it, expect, vi } from 'vitest';
import { EditorStore } from '../src/model/store.js';
import { createActions } from '../src/ui/actions.js';
import { textAiPanel, writePrompt } from '../src/ui/panels/text-ai.js';
import { fixture } from './helpers.js';

describe('write with AI', () => {
  it('builds a prompt with the kind, tone, topic and transcript', () => {
    const p = writePrompt({ kind: 'hook', tone: 'Bold', topic: 'baking bread', transcript: 'today we bake' });
    expect(p).toMatch(/opening hooks/);
    expect(p).toMatch(/bold/);
    expect(p).toMatch(/baking bread/);
    expect(p).toMatch(/today we bake/);
    expect(p).toMatch(/JSON array/);
  });

  it('lists suggestions and adds the chosen one as text', async () => {
    const store = new EditorStore(fixture());
    const ctx = { store, player: { pause() {} }, textAiChat: true };
    ctx.actions = createActions(ctx);
    const chat = vi.fn(async () => '["Bread in 60 seconds", "The crust you deserve"]');
    const panel = textAiPanel(ctx, { chat });
    const el = panel.el;
    document.body.append(el);
    el.querySelector('.ai-topic').value = 'baking bread';
    el.querySelector('.btn.primary').click();
    await vi.waitFor(() => expect(el.querySelectorAll('.ai-line').length).toBe(2));
    el.querySelectorAll('.ai-line')[1].click();
    const texts = store.project.tracks.flatMap((t) => t.clips).filter((c) => c.type === 'text');
    expect(texts.map((c) => c.text)).toEqual(['The crust you deserve']);
    el.remove();
  });
});
