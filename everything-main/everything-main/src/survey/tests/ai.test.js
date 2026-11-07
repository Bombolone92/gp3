import { describe, it, expect, vi } from 'vitest';
import { buildMessages, replyText, extractJson, surveyFromAi, generateSurvey, AI_LIMITS } from '../src/model/ai.js';
import { allQuestions, normalizeSurvey } from '../src/model/survey.js';

const SAMPLE = {
  title: 'Gym feedback',
  description: 'Tell us about your visits.',
  thankYou: 'See you soon!',
  pages: [
    {
      title: 'Visits',
      questions: [
        { type: 'single', title: 'How often do you visit?', choices: ['Daily', 'Weekly', 'Monthly'], required: true, other: true },
        { type: 'nps', title: 'How likely are you to recommend us?' },
        { type: 'matrix', title: 'Rate these', rows: ['Equipment', 'Staff'], columns: ['Poor', 'Fair', 'Good'] },
        { type: 'email', title: 'Your email' },
        { type: 'rating', title: 'Rate the classes', scale: 99 },
        { type: 'hologram', title: 'Unknown type is dropped' },
      ],
    },
  ],
};

describe('buildMessages', () => {
  it('asks for strict JSON and passes the goal and options', () => {
    const [system, user] = buildMessages('Feedback on our gym', { questions: 8, audience: 'members', tone: 'friendly' });
    expect(system.role).toBe('system');
    expect(system.content).toMatch(/ONE JSON object/);
    expect(user.content).toMatch(/Feedback on our gym/);
    expect(user.content).toMatch(/about 8 questions/);
    expect(user.content).toMatch(/members/);
    expect(user.content).toMatch(/friendly/);
  });
});

describe('replyText', () => {
  it('reads strings, normalized and native responses', () => {
    expect(replyText('hi')).toBe('hi');
    expect(replyText({ message: { content: 'x' } })).toBe('x');
    expect(replyText({ message: { content: [{ type: 'text', text: 'a' }, { type: 'text', text: 'b' }] } })).toBe('ab');
    expect(replyText({ toString: () => 'via toString' })).toBe('via toString');
    expect(replyText(null)).toBe('');
    expect(replyText({})).toBe('');
  });
});

describe('extractJson', () => {
  it('finds a survey wrapped in another object', () => {
    const inner = { title: 'T', pages: [{ title: '', questions: [{ type: 'text', title: 'Name?' }] }] };
    expect(extractJson(JSON.stringify({ survey: inner }))).toEqual(inner);
    expect(extractJson('```json\n' + JSON.stringify({ data: { survey: inner } }) + '\n```')).toEqual(inner);
  });
  it('handles code fences and chatter around the object', () => {
    expect(extractJson('Sure! Here it is:\n```json\n{"a": 1}\n```\nEnjoy.')).toEqual({ a: 1 });
  });

  it('respects braces inside strings', () => {
    expect(extractJson('{"t": "a } tricky { one", "n": {"x": 2}} trailing')).toEqual({ t: 'a } tricky { one', n: { x: 2 } });
  });

  it('tolerates trailing commas but not inside strings', () => {
    expect(extractJson('{"a": [1, 2,], "b": "x, ]",}')).toEqual({ a: [1, 2], b: 'x, ]' });
  });

  it('throws on missing or broken JSON', () => {
    expect(() => extractJson('no json here')).toThrow(/did not contain/);
    expect(() => extractJson('{"a": }')).toThrow(/not valid JSON/);
    expect(() => extractJson('{"a": 1')).toThrow(/did not contain/);
  });
});

describe('surveyFromAi', () => {
  it('maps every known type and drops unknown ones', () => {
    const s = surveyFromAi(SAMPLE);
    const qs = allQuestions(s);
    expect(s.title).toBe('Gym feedback');
    expect(s.options.thankYou.message).toBe('See you soon!');
    expect(qs.map((q) => q.type)).toEqual(['single', 'nps', 'matrix', 'text', 'rating']);
    expect(qs[0].other.enabled).toBe(true);
    expect(qs[0].required).toBe(true);
    expect(qs[2].columns.map((c) => c.weight)).toEqual([1, 2, 3]);
    expect(qs[3].validation.kind).toBe('email');
    expect(qs[4].scale).toBe(10);
  });

  it('never trusts ids from the model', () => {
    const s = surveyFromAi({ id: 'evil', pages: [{ id: 'p', questions: [{ id: 'x', type: 'text', title: 'Q' }] }] });
    expect(s.id).not.toBe('evil');
    expect(allQuestions(s)[0].id).not.toBe('x');
  });

  it('accepts top-level questions and type aliases', () => {
    const s = surveyFromAi({ questions: [{ type: 'checkboxes', title: 'Pick', choices: ['a', 'b'] }, { type: 'paragraph', title: 'Why' }] });
    expect(allQuestions(s).map((q) => q.type)).toEqual(['multi', 'textarea']);
  });

  it('downgrades choice questions without enough choices', () => {
    const s = surveyFromAi({ pages: [{ questions: [{ type: 'single', title: 'One?', choices: ['Only'] }] }] });
    expect(allQuestions(s)[0].type).toBe('text');
  });

  it('caps sizes', () => {
    const many = Array.from({ length: 80 }, (_, i) => ({ type: 'text', title: `Q${i}` }));
    const choices = Array.from({ length: 60 }, (_, i) => `c${i}`);
    const s = surveyFromAi({ pages: [{ questions: [{ type: 'single', title: 'Big', choices }, ...many] }] });
    expect(allQuestions(s)).toHaveLength(AI_LIMITS.questions);
    expect(allQuestions(s)[0].choices).toHaveLength(AI_LIMITS.choices);
  });

  it('throws when nothing usable came back', () => {
    expect(() => surveyFromAi({ pages: [] })).toThrow(/usable questions/);
    expect(() => surveyFromAi(null)).toThrow();
  });

  it('returns a normalized survey', () => {
    const s = surveyFromAi(SAMPLE);
    expect(normalizeSurvey(s)).toEqual(s);
  });
});

describe('generateSurvey', () => {
  it('calls chat with messages and parses the reply', async () => {
    const ai = { chat: vi.fn(async () => ({ message: { content: JSON.stringify(SAMPLE) } })) };
    const s = await generateSurvey(ai, 'gym', { questions: 5 });
    expect(s.title).toBe('Gym feedback');
    const [messages, testMode, options] = ai.chat.mock.calls[0];
    expect(Array.isArray(messages)).toBe(true);
    expect(testMode).toBe(false);
    expect(options.normalize).toBe(true);
  });

  it('rejects empty replies and missing AI', async () => {
    await expect(generateSurvey({ chat: async () => ({ message: { content: '' } }) }, 'x')).rejects.toThrow(/empty/);
    await expect(generateSurvey(null, 'x')).rejects.toThrow(/not available/);
  });
});

describe('extractJson with text around the survey', async () => {
  const { extractJson } = await import('../src/model/ai.js');
  it('skips braces in prose before the survey', () => {
    expect(extractJson('Here is the survey in {JSON} form: {"title":"T","pages":[]}')).toEqual({ title: 'T', pages: [] });
  });
  it('skips a reasoning block', () => {
    expect(extractJson('<think>{"plan": 1}</think>\n{"title":"T","questions":[]}')).toEqual({ title: 'T', questions: [] });
  });
  it('never picks a part of a survey over the whole', () => {
    const reply = '{"title":"T","sections":[{"title":"S","questions":[{"q":1}]}]}';
    expect(extractJson(reply)).toEqual(JSON.parse(reply));
  });
  it('never takes a page from a cut-off or broken reply as the survey', () => {
    expect(() => extractJson('{"title":"T","pages":[{"title":"P1","questions":[{"q":1}]},{"title":"P2","quest')).toThrow();
    expect(() => extractJson('{"title":"T", // note\n"pages":[{"title":"P1","questions":[]}]}')).toThrow('not valid JSON');
  });
  it('still explains replies with no usable object', () => {
    expect(() => extractJson('no braces here')).toThrow('did not contain');
    expect(() => extractJson('{not json at all}')).toThrow('not valid JSON');
  });
});

