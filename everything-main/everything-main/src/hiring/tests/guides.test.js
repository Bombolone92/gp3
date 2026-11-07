import { describe, it, expect } from 'vitest';
import {
  defaultGuideFor,
  findGuide,
  guideAppliesText,
  guidesFrom,
  MAX_GUIDES,
  MAX_GUIDE_QUESTIONS,
  normalizeGuideAnswers,
  normalizeGuides,
} from '../src/core/guides.js';

const guide = (over = {}) => ({
  id: 'gd1',
  name: 'Phone screen',
  questions: [{ id: 'q1', text: 'Walk me through your last project', field: 'skills' }],
  types: ['phone'],
  stages: ['screen'],
  ...over,
});

describe('normalizeGuides', () => {
  it('keeps well-formed guides and their attachments', () => {
    expect(normalizeGuides([guide()])).toEqual([
      {
        id: 'gd1',
        name: 'Phone screen',
        questions: [{ id: 'q1', text: 'Walk me through your last project', field: 'skills' }],
        types: ['phone'],
        stages: ['screen'],
      },
    ]);
  });

  it('drops what cannot be rendered or written back', () => {
    expect(normalizeGuides(null)).toEqual([]);
    expect(normalizeGuides([guide({ id: '../x' })])).toEqual([]);
    expect(normalizeGuides([guide({ name: '  ' })])).toEqual([]);
    // A guide with no usable question is not a guide.
    expect(normalizeGuides([guide({ questions: [{ id: 'q1', text: '   ' }] })])).toEqual([]);
    expect(normalizeGuides([guide({ questions: 'nope' })])).toEqual([]);
  });

  it('rejects unknown formats, unsafe stage keys, and duplicate ids', () => {
    const [g] = normalizeGuides([guide({ types: ['phone', 'telepathy'], stages: ['screen', '../x'] })]);
    expect(g.types).toEqual(['phone']);
    expect(g.stages).toEqual(['screen']);
    expect(normalizeGuides([guide(), guide({ name: 'Duplicate' })])).toHaveLength(1);
  });

  it('caps guides and questions', () => {
    const many = Array.from({ length: 20 }, (_, i) => guide({ id: `gd${i}` }));
    expect(normalizeGuides(many)).toHaveLength(MAX_GUIDES);
    const long = guide({ questions: Array.from({ length: 40 }, (_, i) => ({ id: `q${i}`, text: `Q${i}` })) });
    expect(normalizeGuides([long])[0].questions).toHaveLength(MAX_GUIDE_QUESTIONS);
  });

  it('reads an account with no guides as none', () => {
    expect(guidesFrom({})).toEqual([]);
    expect(guidesFrom(null)).toEqual([]);
    expect(findGuide({}, 'gd1')).toBeNull();
    expect(findGuide({ guides: [guide()] }, 'gd1').name).toBe('Phone screen');
    expect(findGuide({ guides: [guide()] }, '')).toBeNull();
  });
});

describe('defaultGuideFor', () => {
  const settings = {
    guides: [
      guide({ id: 'screen', name: 'Screen', types: ['phone'], stages: ['screen'] }),
      guide({ id: 'onsite', name: 'Onsite loop', types: ['onsite'], stages: [] }),
      guide({ id: 'stageonly', name: 'Interview stage', types: [], stages: ['interview'] }),
      guide({ id: 'manual', name: 'By hand', types: [], stages: [] }),
    ],
  };

  it('prefers a format match over a stage match', () => {
    expect(defaultGuideFor(settings, { type: 'onsite', stage: 'interview' }).id).toBe('onsite');
    expect(defaultGuideFor(settings, { type: 'video', stage: 'interview' }).id).toBe('stageonly');
    expect(defaultGuideFor(settings, { type: 'phone', stage: 'screen' }).id).toBe('screen');
  });

  it('offers nothing when nothing matches', () => {
    expect(defaultGuideFor(settings, { type: 'video', stage: 'applied' })).toBeNull();
    expect(defaultGuideFor({}, { type: 'phone' })).toBeNull();
  });

  it('says what a guide is offered for', () => {
    expect(guideAppliesText({ types: ['phone'], stages: ['screen'] }, () => 'Screening')).toBe('Phone screen · Screening');
    expect(guideAppliesText({ types: [], stages: [] })).toBe('Picked by hand');
  });
});

describe('normalizeGuideAnswers', () => {
  it('keeps answered questions with their dimension', () => {
    expect(
      normalizeGuideAnswers([
        { question: ' Tell me about X ', answer: ' They shipped it ', field: 'skills' },
        { question: 'Unanswered', answer: '   ' },
        { question: '', answer: 'orphan' },
        { question: 'No dimension', answer: 'fine', field: '../x' },
      ])
    ).toEqual([
      { question: 'Tell me about X', answer: 'They shipped it', field: 'skills' },
      { question: 'No dimension', answer: 'fine' },
    ]);
  });

  it('is null when nothing was answered', () => {
    expect(normalizeGuideAnswers([])).toBeNull();
    expect(normalizeGuideAnswers([{ question: 'Q', answer: '' }])).toBeNull();
    expect(normalizeGuideAnswers('nope')).toBeNull();
  });
});
