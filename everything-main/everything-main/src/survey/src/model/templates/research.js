/** Market research templates. */
import { single, multi, rating, matrix, long, page, dropdown, ranking, slider, note, text } from './dsl.js';

export default [
  {
    id: 'concept-test',
    name: 'Product concept test',
    category: 'research',
    summary: 'Test a new idea with your target audience before you build it.',
    theme: 'plum',
    intro: 'We are exploring a new product idea and would value your honest reaction. This takes about two minutes.',
    thankYou: { title: 'Thank you', message: 'Your reaction helps us decide what to build next.' },
    pages: [
      page('About you', [
        single('Which best describes you?', ['I run a small business', 'I work at a large company', 'I am a freelancer', 'I am a student', 'None of these'], {
          required: true,
          skip: { 'None of these': 'disqualify' },
        }),
        dropdown('How old are you?', 'age'),
      ]),
      page('The idea', [
        note('Imagine this', 'Replace this text with a short description of your product idea: what it is, who it is for, and the main problem it solves.'),
        single('How appealing is this idea to you?', ['Not at all appealing', 'Slightly appealing', 'Moderately appealing', 'Very appealing', 'Extremely appealing'], { required: true }),
        single('How likely would you be to try it?', 'likely5', { required: true }),
        single('How new or different does it feel compared to what you use today?', ['Not at all new', 'Slightly new', 'Somewhat new', 'Very new']),
        long('What do you like most about the idea?'),
        long('What concerns would stop you from trying it?'),
      ]),
    ],
  },
  {
    id: 'pricing-research',
    name: 'Pricing research',
    category: 'research',
    summary: 'Gauge willingness to pay and which plan features matter most.',
    theme: 'paper',
    intro: 'Help us price our product fairly. There are no right answers; we just want your view.',
    thankYou: { title: 'Thanks for your input', message: 'We appreciate your help making our pricing work for customers like you.' },
    pages: [
      page('', [
        single('How do you prefer to pay for software?', ['Monthly subscription', 'Yearly subscription', 'One-time purchase', 'Pay as I go'], { required: true }),
        slider('At what monthly price would this product feel like a good deal?', { min: 0, max: 100, step: 5, minLabel: '$0', maxLabel: '$100' }),
        slider('At what monthly price would it feel too expensive to consider?', { min: 0, max: 200, step: 5, minLabel: '$0', maxLabel: '$200' }),
        ranking('Rank these plan features by importance to you.', ['More storage', 'Priority support', 'Team accounts', 'Advanced reports', 'Integrations']),
        multi('Which would make you more comfortable paying?', ['A free trial', 'A money-back guarantee', 'A free plan with limits', 'Discounts for nonprofits or students'], {
          none: { enabled: true, label: 'None of these' },
        }),
        long('Anything else about pricing we should know?'),
      ]),
    ],
  },
  {
    id: 'brand-awareness',
    name: 'Brand awareness',
    category: 'research',
    summary: 'Measure recognition and perception of your brand against others.',
    theme: 'graphite',
    intro: 'A short survey about brands in this category. It takes about two minutes.',
    thankYou: { title: 'Thank you', message: 'Your responses are anonymous and used only for research.' },
    pages: [
      page('', [
        text('When you think of companies in this category, which one comes to mind first?', { required: true }),
        multi('Which of these brands have you heard of?', ['Brand A', 'Brand B', 'Brand C', 'Brand D'], {
          none: { enabled: true, label: 'None of these' },
          required: true,
          key: 'heard',
        }),
        single('Have you used Brand A in the last year?', ['Yes', 'No'], { showIf: ['heard', 'is', 'Brand A'], key: 'used' }),
        rating('How would you rate your experience with Brand A?', { scale: 5, showIf: ['used', 'is', 'Yes'] }),
        matrix('How well do these words describe Brand A?', ['Trustworthy', 'Innovative', 'Good value', 'Friendly'], ['Not at all', 'Slightly', 'Moderately', 'Very well'], {
          showIf: ['heard', 'is', 'Brand A'],
        }),
        multi('Where have you seen or heard about Brand A recently?', ['Online ads', 'Social media', 'TV or radio', 'From friends or family', 'In a store'], {
          none: { enabled: true, label: 'Nowhere recently' },
          showIf: ['heard', 'is', 'Brand A'],
        }),
      ]),
    ],
  },
];
