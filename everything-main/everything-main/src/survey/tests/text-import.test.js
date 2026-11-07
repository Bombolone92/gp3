import { describe, it, expect } from 'vitest';
import { parseQuestions, toSurveyPages } from '../src/model/text-import.js';
import { splitPastedLines } from '../src/model/list-lines.js';
import { normalizeSurvey, makeSurvey } from '../src/model/survey.js';

const flat = (text) => parseQuestions(text).pages.flatMap((p) => p.questions);
const labels = (q) => q.choices.map((c) => c.label);

describe('parseQuestions', () => {
  it('returns nothing for empty or blank input', () => {
    expect(parseQuestions('')).toEqual({ pages: [], count: 0 });
    expect(parseQuestions('   \n\n  ')).toEqual({ pages: [], count: 0 });
    expect(parseQuestions(null).count).toBe(0);
  });

  it('reads bulleted choices under a question', () => {
    const [q] = flat('What is your favorite color?\n- Red\n- Green\n- Blue');
    expect(q.type).toBe('single');
    expect(q.title).toBe('What is your favorite color?');
    expect(labels(q)).toEqual(['Red', 'Green', 'Blue']);
  });

  it('accepts every common choice marker', () => {
    for (const marks of [['a)', 'b)'], ['A.', 'B.'], ['*', '*'], ['•', '•'], ['o', 'o'], ['( )', '( )'], ['1.', '2.'], ['1)', '2)']]) {
      const [q] = flat(`Pick one?\n${marks[0]} Yes\n${marks[1]} No`);
      expect(labels(q), marks.join(' ')).toEqual(['Yes', 'No']);
    }
  });

  it('keeps words that start with page, section or part as text', () => {
    const r = parseQuestions('What is your employment status?\nFull-time\nPart-time\nUnemployed\nRetired');
    expect(r.pages).toHaveLength(1);
    expect(labels(r.pages[0].questions[0])).toEqual(['Full-time', 'Part-time', 'Unemployed', 'Retired']);
    for (const head of ['Part 2 - Background', 'Part 2 – Background', 'Section: Background', 'Page 2. Background', 'Part 3: Background']) {
      const pages = parseQuestions(`First?\n\n${head}\n\nSecond?`).pages;
      expect(pages.map((p) => p.title), head).toEqual(['', 'Background']);
    }
  });

  it('needs a space after a letter or number marker', () => {
    const [q] = flat('How long does it take?\n1.5 to 3 hours\n3 to 5 hours');
    expect(labels(q)).toEqual(['1.5 to 3 hours', '3 to 5 hours']);
    expect(labels(flat('Gender?\na)Male\nb)Female')[0])).toEqual(['Male', 'Female']);
    expect(labels(flat('Color?\n1)Red\n2)Blue')[0])).toEqual(['Red', 'Blue']);
    const [r] = flat('Where do you live?\nU.S. residents only\nElsewhere');
    expect(labels(r)).toEqual(['U.S. residents only', 'Elsewhere']);
  });

  it('reads the scale from the scale phrase only', () => {
    const [q] = flat('How did COVID-19 affect you, on a scale of 1 to 5?');
    expect(q.type).toBe('rating');
    expect(q.scale).toBe(5);
  });

  it('reads "1 to N" as a rating only where it is a scale', () => {
    const qs = flat('How would you rate us? (1 to 5 stars)\n\nOverall, 1-10 scale?\n\nRate our support (1 to 7)\n\nRating from 0 to 10: would you recommend us?\n\nHow many children aged 1 to 5 live with you?\n\nBetween 1 to 3 days, how long did delivery take?');
    expect(qs.map((q) => q.type)).toEqual(['rating', 'rating', 'rating', 'nps', 'text', 'text']);
    expect(qs.slice(0, 3).map((q) => q.scale)).toEqual([5, 10, 7]);
  });

  it('starts pages at sections named by letters or Roman numerals', () => {
    const titles = (t) => parseQuestions(t).pages.map((p) => p.title);
    expect(titles('Section A: About you\nYour name?\n\nSection B: Your visit\nHow was it?')).toEqual(['About you', 'Your visit']);
    expect(titles('Part I - Background\nYour role?\n\nPart II - Feedback\nAny comments?')).toEqual(['Background', 'Feedback']);
    // Without a title they could be answers: they stay text.
    expect(labels(flat('Which section did you sit in?\nSection A\nSection B')[0])).toEqual(['Section A', 'Section B']);
  });

  it('reads lines with long runs of spaces quickly, as single spaces', () => {
    const t0 = Date.now();
    const [q] = flat('What  is\tyour' + ' '.repeat(100_000) + 'name?\n-  Ada\n-  Bo' + ' '.repeat(100_000) + '*');
    expect(Date.now() - t0).toBeLessThan(500);
    expect(q.title).toBe('What is your name?');
    expect(labels(q)).toEqual(['Ada', 'Bo *']);
    expect(flat('Page' + ' '.repeat(100_000) + 'x')).toHaveLength(1);
  });

  it('treats unmarked short lines as choices only when there are two or more', () => {
    expect(labels(flat('Your team?\nSales\nSupport\nEngineering')[0])).toEqual(['Sales', 'Support', 'Engineering']);
    const [q] = flat('Your role?\nPlease answer briefly.');
    expect(q.type).toBe('text');
    expect(q.description).toBe('Please answer briefly.');
  });

  it('makes checkboxes from [ ] markers or "select all" wording', () => {
    expect(flat('Tools you use?\n[ ] Email\n[x] Chat')[0].type).toBe('multi');
    expect(flat('Which apply? (select all that apply)\n- A\n- B')[0].type).toBe('multi');
    expect(flat('Check all that apply\n- A\n- B')[0].type).toBe('multi');
  });

  it('uses a dropdown for long lists', () => {
    const choices = Array.from({ length: 14 }, (_, i) => `- Country ${i + 1}`).join('\n');
    expect(flat(`Where do you live?\n${choices}`)[0].type).toBe('dropdown');
  });

  it('picks text types from the wording', () => {
    const qs = flat('Describe your experience.\n\nWhat is your email address?\n\nYour name\n\nOn a scale of 0 to 10, how likely are you to recommend us?\n\nOn a scale of 1 to 7, rate the service');
    expect(qs.map((q) => q.type)).toEqual(['textarea', 'text', 'text', 'nps', 'rating']);
    expect(qs[1].validation.kind).toBe('email');
    expect(qs[4].scale).toBe(7);
  });

  it('splits questions without blank lines on "?" and on numbering', () => {
    const qs = flat('1. How old are you?\n- Under 18\n- 18 or older\n2. Where do you live?\n3. Any comments?');
    expect(qs.map((q) => q.title)).toEqual(['How old are you?', 'Where do you live?', 'Any comments?']);
    expect(labels(qs[0])).toEqual(['Under 18', '18 or older']);
  });

  it('keeps numbered choices under a numbered question', () => {
    const qs = flat('1. Pick a size?\n1. Small\n2. Medium\n3. Large\n\n2. Anything else?');
    expect(qs).toHaveLength(2);
    expect(labels(qs[0])).toEqual(['Small', 'Medium', 'Large']);
  });

  it('strips question numbering styles', () => {
    const titles = flat('Q1: First?\n\nQuestion 2. Second?\n\n3) Third?').map((q) => q.title);
    expect(titles).toEqual(['First?', 'Second?', 'Third?']);
  });

  it('marks required questions', () => {
    const qs = flat('* Your name\n\nYour email *\n\nYour age (required)\n\nYour city');
    expect(qs.map((q) => q.required)).toEqual([true, true, true, false]);
    expect(qs.map((q) => q.title)).toEqual(['Your name', 'Your email', 'Your age', 'Your city']);
  });

  it('keeps a "*" bullet ending in ? as a required question, not a choice', () => {
    const qs = flat('Pick one?\n* Yes\n* No\n* Why did you pick it?');
    expect(qs).toHaveLength(2);
    expect(labels(qs[0])).toEqual(['Yes', 'No']);
    expect(qs[1]).toMatchObject({ title: 'Why did you pick it?', required: true });
  });

  it('turns Other and None choices into built-in options', () => {
    const [q] = flat('Which apply? Select all.\n- A\n- B\n- Other (please specify)\n- None of the above');
    expect(labels(q)).toEqual(['A', 'B']);
    expect(q.other).toEqual({ enabled: true, label: 'Other (please specify)' });
    expect(q.none).toEqual({ enabled: true, label: 'None of the above' });
    const [single] = flat('Pick?\n- A\n- None');
    expect(labels(single)).toEqual(['A', 'None']);
  });

  it('starts pages at rules and page headings', () => {
    const r = parseQuestions('Page: About you\nName?\n\nAge?\n---\nComments?\n\n## Wrap up\nAnything else?');
    expect(r.pages.map((p) => p.title)).toEqual(['About you', '', 'Wrap up']);
    expect(r.pages.map((p) => p.questions.length)).toEqual([2, 1, 1]);
    expect(r.count).toBe(4);
  });

  it('does not treat a question that mentions a section as a page break', () => {
    const r = parseQuestions('Section: which part did you like best?\n- Intro\n- Ending');
    expect(r.pages).toHaveLength(1);
    expect(r.pages[0].questions[0].type).toBe('single');
  });

  it('makes text blocks from notes', () => {
    const [q] = flat('Note: Answer honestly.\nThere are no wrong answers.');
    expect(q.type).toBe('statement');
    expect(q.title).toBe('Answer honestly. There are no wrong answers.');
  });

  it('handles Windows line endings and stray whitespace', () => {
    const qs = flat('  Color?  \r\n  - Red \r\n - Blue\r\n\r\nSize?');
    expect(qs).toHaveLength(2);
    expect(labels(qs[0])).toEqual(['Red', 'Blue']);
  });

  it('produces questions that survive normalization', () => {
    const parsed = parseQuestions('Name?\n\nPick one?\n- A\n- B\n\nTools? Select all that apply.\n[ ] X\n[ ] Y');
    const survey = normalizeSurvey(makeSurvey({ pages: toSurveyPages(parsed) }));
    expect(survey.pages[0].questions.map((q) => q.type)).toEqual(['text', 'single', 'multi']);
  });
});

describe('surveyFromFile', async () => {
  const { surveyFromFile } = await import('../src/views/import-dialog.js');
  const { makeQuestion } = await import('../src/model/survey.js');

  const exported = () => {
    const s = makeSurvey({ title: 'Exported' });
    s.pages[0].questions = [makeQuestion('text', { title: 'Name?' })];
    return s;
  };

  it('reads an exported file and gives it a fresh id', () => {
    const s = exported();
    const r = surveyFromFile({ format: 'puter-survey', version: 1, survey: s });
    expect(r.survey.title).toBe('Exported');
    expect(r.survey.id).not.toBe(s.id);
    expect(r.survey.pages[0].questions[0].title).toBe('Name?');
  });

  it('accepts a bare survey object', () => {
    expect(surveyFromFile(exported()).survey.title).toBe('Exported');
  });

  it('rejects files that are not surveys or have no questions', () => {
    expect(surveyFromFile(null).error).toMatch(/does not contain/);
    expect(surveyFromFile({ hello: 1 }).error).toMatch(/does not contain/);
    expect(surveyFromFile({ pages: [] }).error).toMatch(/no questions/);
  });
});

describe('splitPastedLines', () => {
  it('drops list markers when every line has one', () => {
    expect(splitPastedLines('a) Yes\nb) No')).toEqual(['Yes', 'No']);
    expect(splitPastedLines('1. One\r\n2. Two\n\n- Three')).toEqual(['One', 'Two', 'Three']);
    expect(splitPastedLines('  * Red  \n• Blue')).toEqual(['Red', 'Blue']);
  });

  it('keeps short words that look like markers', () => {
    expect(splitPastedLines('Mr. Smith\nDr. Who\nSt. Louis\nNo. 5')).toEqual(['Mr. Smith', 'Dr. Who', 'St. Louis', 'No. 5']);
    expect(splitPastedLines('A. Lincoln\nG. Washington\nOther')).toEqual(['A. Lincoln', 'G. Washington', 'Other']);
  });

  it('drops markers that count up in order even when some lines have none', () => {
    expect(splitPastedLines('a. Yes\nb. No\nOther')).toEqual(['Yes', 'No', 'Other']);
    expect(splitPastedLines('1) Red\n2) Blue\nSomething else')).toEqual(['Red', 'Blue', 'Something else']);
    expect(splitPastedLines('a. Only one marked\nOther')).toEqual(['a. Only one marked', 'Other']);
    expect(splitPastedLines('A. Lincoln\nG. Washington')).toEqual(['A. Lincoln', 'G. Washington']);
    expect(splitPastedLines('1. One\n1. Two')).toEqual(['One', 'Two']);
    expect(splitPastedLines('Yes\nNo')).toEqual(['Yes', 'No']);
  });
});
