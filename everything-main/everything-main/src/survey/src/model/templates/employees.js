/** Employee and workplace templates. */
import { single, multi, rating, nps, matrix, long, text, page, dropdown, ranking, slider, note } from './dsl.js';

const DEPARTMENTS = ['Engineering', 'Sales', 'Marketing', 'Operations', 'Customer support', 'Finance', 'People and HR'];

export default [
  {
    id: 'employee-engagement',
    name: 'Employee engagement',
    category: 'employees',
    summary: 'A yearly pulse on motivation, growth, recognition, and belonging.',
    theme: 'forest',
    intro: 'This survey is anonymous. We share only combined results, never individual answers. Please answer honestly; it takes about three minutes.',
    thankYou: { title: 'Thank you for sharing', message: 'We will share what we learned and what we plan to do about it within a month.' },
    pages: [
      page('About you', [
        dropdown('Which team are you part of?', DEPARTMENTS, { other: { enabled: true, label: 'Another team' } }),
        single('How long have you worked here?', ['Less than 6 months', '6 to 12 months', '1 to 3 years', '3 to 5 years', 'More than 5 years']),
      ]),
      page('Your work', [
        matrix('How much do you agree with each statement?', [
          'I find my work meaningful',
          'I have the tools I need to do my job well',
          'I know what is expected of me',
          'My workload is manageable',
          'I can be myself at work',
        ], 'agree5', { required: true }),
        matrix('And these?', [
          'I receive regular, useful feedback',
          'My work is recognized',
          'I see a path to grow here',
          'I trust the leadership team',
        ], 'agree5'),
      ]),
      page('Looking forward', [
        nps('How likely are you to recommend this company as a place to work?', { required: true }),
        single('Do you see yourself working here in two years?', ['Yes', 'Not sure', 'No']),
        long('What is one thing that would make this a better place to work?'),
      ]),
    ],
  },
  {
    id: 'onboarding-checkin',
    name: 'New hire onboarding check-in',
    category: 'employees',
    summary: 'Check in with new team members after their first weeks.',
    theme: 'meadow',
    intro: 'Welcome aboard! Tell us how your first weeks have gone so we can make onboarding better for you and the people who join after you.',
    thankYou: { title: 'Thanks, and welcome again', message: 'Your manager and the people team will review your answers.' },
    pages: [
      page('', [
        single('How long ago did you start?', ['1 to 2 weeks ago', '3 to 4 weeks ago', '1 to 2 months ago', 'More than 2 months ago']),
        rating('How would you rate your onboarding so far?', { scale: 5, required: true }),
        matrix('How prepared do you feel in these areas?', [
          'Understanding my role',
          'Knowing who to ask for help',
          'Using our tools and systems',
          'Understanding team goals',
        ], ['Not prepared', 'Somewhat prepared', 'Prepared', 'Very prepared']),
        single('Did you have everything you needed on day one?', ['Yes', 'No'], { key: 'ready' }),
        long('What was missing?', { showIf: ['ready', 'is', 'No'] }),
        long('What has been the most helpful part of onboarding?'),
        long('What should we change for the next new hire?'),
      ]),
    ],
  },
  {
    id: 'exit-interview',
    name: 'Exit interview',
    category: 'employees',
    summary: 'Understand why people leave and what could have kept them.',
    theme: 'slate',
    intro: 'Thank you for your time with us. Your honest answers help us improve for everyone who stays. Responses are confidential.',
    thankYou: { title: 'Thank you, and all the best', message: 'We wish you every success in what comes next.' },
    pages: [
      page('Your decision', [
        multi('What are the main reasons you are leaving?', [
          'Career growth',
          'Compensation or benefits',
          'Manager relationship',
          'Workload or stress',
          'Company direction',
          'Relocation or personal reasons',
        ], { other: { enabled: true, label: 'Another reason' }, required: true, maxSelect: 3 }),
        single('Could anything have changed your mind?', ['Yes', 'Maybe', 'No'], { key: 'stay' }),
        long('What could we have done?', { showIf: ['stay', 'isNot', 'No'] }),
      ]),
      page('Your time here', [
        matrix('How would you rate the following?', ['Your manager', 'Your team', 'Learning opportunities', 'Pay and benefits', 'Work-life balance'], 'quality5'),
        single('Would you consider working here again in the future?', 'yesnomaybe'),
        long('Any other advice for us?'),
      ]),
    ],
  },
  {
    id: 'remote-work',
    name: 'Remote and hybrid work',
    category: 'employees',
    summary: 'Learn how people feel about where and how they work.',
    theme: 'teal',
    intro: 'We want our ways of working to suit our team. Tell us what works for you and what does not.',
    thankYou: { title: 'Thanks for your input', message: 'We will use these results to shape our workplace plans.' },
    pages: [
      page('', [
        single('Where do you mostly work today?', ['Fully remote', 'Mostly remote', 'Half and half', 'Mostly in the office', 'Fully in the office'], { required: true }),
        slider('Ideally, how many days a week would you like to work in the office?', { min: 0, max: 5, step: 1, minLabel: '0 days', maxLabel: '5 days' }),
        matrix('How much do you agree?', [
          'I can focus well where I work',
          'I feel connected to my team',
          'Meetings are a good use of my time',
          'I can switch off at the end of the day',
        ], 'agree5'),
        ranking('Rank what you value most about the office.', ['Seeing colleagues', 'Quiet space to focus', 'Better equipment', 'Separating work from home', 'Learning from others']),
        long('What would most improve your working week?'),
      ]),
    ],
  },
  {
    id: 'manager-feedback',
    name: 'Manager feedback',
    category: 'employees',
    summary: 'Give managers anonymous, actionable upward feedback.',
    theme: 'plum',
    intro: 'Your answers are anonymous and combined with your teammates before your manager sees them.',
    thankYou: { title: 'Thank you', message: 'Good feedback helps good managers get even better.' },
    pages: [
      page('', [
        matrix('My manager...', [
          'Gives me clear goals',
          'Gives me useful feedback',
          'Supports my growth',
          'Treats everyone fairly',
          'Keeps me informed',
          'Is available when I need help',
        ], 'agree5', { required: true }),
        rating('Overall, how effective is your manager?', { scale: 5, required: true }),
        long('What should your manager keep doing?'),
        long('What should your manager start or stop doing?'),
      ]),
    ],
  },
  {
    id: 'training-evaluation',
    name: 'Training evaluation',
    category: 'employees',
    summary: 'Find out whether a training session was useful and well run.',
    theme: 'sand',
    intro: 'Thanks for attending. Please tell us what you thought of the session.',
    thankYou: { title: 'Thanks for your feedback', message: 'It helps us plan better training for everyone.' },
    pages: [
      page('', [
        text('Which training session did you attend?', { required: true }),
        rating('How would you rate the session overall?', { scale: 5, required: true }),
        matrix('How much do you agree?', [
          'The content was relevant to my work',
          'The trainer explained things clearly',
          'The pace was right',
          'I can apply what I learned',
        ], 'agree5'),
        single('Was the session length right?', ['Too short', 'About right', 'Too long']),
        long('What was the most useful thing you learned?'),
        long('What topics would you like covered in future sessions?'),
        note('', 'Thank you for taking the time to help us improve.'),
      ]),
    ],
  },
];
