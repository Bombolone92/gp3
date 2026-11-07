/** Everyday templates: small, quick surveys and forms. */
import { single, multi, rating, long, text, page, contact, date, boxes, dropdown, note } from './dsl.js';

export default [
  {
    id: 'meeting-feedback',
    name: 'Meeting feedback',
    category: 'everyday',
    summary: 'Find out whether a recurring meeting is worth everyone’s time.',
    theme: 'slate',
    intro: 'Help us make our meetings shorter and more useful. This takes one minute.',
    thankYou: { title: 'Thanks', message: 'We will review the results at the next meeting.' },
    pages: [
      page('', [
        rating('How useful was this meeting?', { scale: 5, required: true, minLabel: 'Not useful', maxLabel: 'Very useful' }),
        single('Was the meeting length right?', ['Too short', 'About right', 'Too long']),
        single('Did the meeting have a clear purpose and outcome?', ['Yes', 'Somewhat', 'No']),
        single('Could this meeting have been an email or a message?', ['Yes', 'Maybe', 'No']),
        long('How could we make it better?'),
      ]),
    ],
  },
  {
    id: 'quick-poll',
    name: 'Quick poll',
    category: 'everyday',
    summary: 'One question, fast answers. Perfect for a quick team decision.',
    theme: 'rose',
    options: { format: 'focus', progressBar: 'off', numbering: false },
    intro: '',
    thankYou: { title: 'Vote recorded', message: 'Thanks for taking part.' },
    pages: [
      page('', [
        single('Which option do you prefer?', ['Option A', 'Option B', 'Option C'], { required: true }),
        long('Anything you would like to add?', { placeholder: 'Optional' }),
      ]),
    ],
  },
  {
    id: 'contact-form',
    name: 'Contact form',
    category: 'everyday',
    summary: 'A simple form for questions, requests, and messages.',
    theme: 'paper',
    options: { numbering: false, buttons: { prev: 'Back', next: 'Next', done: 'Send message' } },
    intro: 'Send us a message and we will get back to you within two business days.',
    thankYou: { title: 'Message sent', message: 'Thanks for getting in touch. We will reply soon.' },
    pages: [
      page('', [
        contact('Your details', ['name', 'email', 'phone'], { required: ['name', 'email'] }),
        dropdown('What is your message about?', ['A question', 'A support request', 'Sales and pricing', 'Partnerships', 'Feedback'], {
          other: { enabled: true, label: 'Something else' },
          required: true,
        }),
        long('Your message', { required: true, placeholder: 'How can we help?' }),
        single('How should we reply?', ['Email', 'Phone'], { layout: 'horizontal' }),
      ]),
    ],
  },
  {
    id: 'event-rsvp',
    name: 'Team lunch RSVP',
    category: 'everyday',
    summary: 'Collect RSVPs, guests, and food choices for a team get-together.',
    theme: 'meadow',
    options: { numbering: false },
    intro: 'Join us for a team lunch! Let us know if you can make it by Friday.',
    thankYou: { title: 'Thanks for letting us know', message: 'See you there!' },
    pages: [
      page('', [
        text('Your name', { required: true }),
        single('Can you make it?', ['Yes, I will be there', 'Sorry, I cannot make it'], {
          required: true,
          key: 'going',
          skip: { 'Sorry, I cannot make it': 'end' },
        }),
        single('Are you bringing a guest?', ['No', 'Yes, one guest'], { showIf: ['going', 'is', 'Yes, I will be there'], key: 'guest' }),
        boxes('Guest details', ['Guest name', 'Guest dietary needs'], { showIf: ['guest', 'is', 'Yes, one guest'] }),
        multi('Which dishes would you like?', ['Pizza', 'Salads', 'Sandwiches', 'Sushi', 'Vegetarian options'], { showIf: ['going', 'is', 'Yes, I will be there'] }),
        date('If the date changes, when else could you make it?', { showIf: ['going', 'is', 'Yes, I will be there'] }),
        note('', 'We will send a calendar invitation to everyone who says yes.'),
      ]),
    ],
  },
];
