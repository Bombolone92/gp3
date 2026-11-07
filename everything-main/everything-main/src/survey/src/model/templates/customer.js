/** Customer feedback templates. */
import { single, multi, rating, nps, matrix, long, text, page, dropdown, ranking, contact, note } from './dsl.js';

export default [
  {
    id: 'customer-satisfaction',
    name: 'Customer satisfaction',
    category: 'customer',
    summary: 'Measure how happy customers are with a recent purchase and what to improve.',
    theme: 'ocean',
    intro: 'Thanks for choosing us. This short survey helps us understand what went well and what we can do better. It takes about three minutes.',
    thankYou: { title: 'Thank you for your feedback', message: 'Every response is read by our team and helps us improve.' },
    pages: [
      page('Your experience', [
        single('Overall, how satisfied are you with your recent purchase?', 'satisfied5', { required: true, key: 'overall' }),
        matrix(
          'How would you rate us on each of the following?',
          ['Product quality', 'Value for money', 'Ease of ordering', 'Delivery speed', 'Communication'],
          'quality5',
        ),
        single('Did the product meet your expectations?', 'expect3'),
        long('What disappointed you, and what could we have done differently?', {
          showIf: ['overall', 'isNot', 'Very satisfied'],
        }),
      ]),
      page('Looking ahead', [
        single('How likely are you to buy from us again?', 'likely5', { required: true }),
        multi('Which of these would make you more likely to come back?', [
          'Lower prices',
          'Faster delivery',
          'A wider selection',
          'Better product information',
          'A loyalty program',
        ], { other: { enabled: true, label: 'Something else' } }),
        long('Is there anything else you would like to tell us?'),
      ]),
    ],
  },
  {
    id: 'recommend-score',
    name: 'Likelihood to recommend',
    category: 'customer',
    summary: 'The classic 0 to 10 recommendation question, with a follow-up for the reason.',
    theme: 'paper',
    intro: 'A few quick questions. Your answers help us understand what matters most to you.',
    thankYou: { title: 'Thanks for your time', message: 'We appreciate you helping us improve.' },
    pages: [
      page('', [
        nps('How likely are you to recommend us to a friend or colleague?', { required: true }),
        long('What is the main reason for your score?', { placeholder: 'Tell us in a sentence or two' }),
        single('May we follow up with you about your answer?', ['Yes', 'No'], { key: 'followup' }),
        text('What is the best email address to reach you?', {
          showIf: ['followup', 'is', 'Yes'],
          validation: { kind: 'email', min: '', max: '', message: '' },
        }),
      ]),
    ],
  },
  {
    id: 'product-feedback',
    name: 'Product feedback',
    category: 'customer',
    summary: 'Learn how people use your product, which features they value, and what is missing.',
    theme: 'plum',
    intro: 'We are always working to make our product better. Tell us how it works for you today.',
    thankYou: { title: 'Thanks for helping shape the product', message: 'Your ideas go straight to our product team.' },
    pages: [
      page('How you use it', [
        single('How often do you use the product?', ['Every day', 'A few times a week', 'A few times a month', 'Less than once a month'], { required: true }),
        multi('What do you mainly use it for?', ['Work', 'Personal projects', 'School', 'Collaborating with others'], {
          other: { enabled: true, label: 'Other (please specify)' },
        }),
        ranking('Rank these features from most to least valuable to you.', ['Speed', 'Ease of use', 'Integrations', 'Reliability', 'Price']),
      ]),
      page('What we could improve', [
        rating('How would you rate the product overall?', { scale: 5, required: true }),
        long('What is one thing we should add or change?'),
        single('How would you feel if you could no longer use the product?', ['Very disappointed', 'Somewhat disappointed', 'Not disappointed']),
      ]),
    ],
  },
  {
    id: 'website-usability',
    name: 'Website usability',
    category: 'customer',
    summary: 'Find out whether visitors can find what they need and where they get stuck.',
    theme: 'slate',
    intro: 'Help us make our website easier to use. This takes about three minutes.',
    thankYou: { title: 'Thank you', message: 'Your feedback helps us build a better website for everyone.' },
    pages: [
      page('', [
        single('What was the main reason for your visit today?', [
          'Learn about products or services',
          'Make a purchase',
          'Get help or support',
          'Check an order or account',
        ], { other: { enabled: true, label: 'Something else' }, required: true }),
        single('Were you able to do what you came to do?', ['Yes', 'Partly', 'No'], { required: true, key: 'done' }),
        long('What got in your way?', { showIf: ['done', 'isNot', 'Yes'] }),
        single('How easy was it to find your way around the site?', 'easy5'),
        matrix('How much do you agree with these statements?', [
          'The pages load quickly',
          'The text is easy to read',
          'The layout makes sense',
          'The site works well on my phone',
        ], 'agree5'),
        long('Any other suggestions for our website?'),
      ]),
    ],
  },
  {
    id: 'support-experience',
    name: 'Support experience',
    category: 'customer',
    summary: 'Follow up after a support request to check the issue was resolved.',
    theme: 'teal',
    intro: 'You recently contacted our support team. We would love to hear how it went.',
    thankYou: { title: 'Thanks for letting us know', message: 'We use this feedback to coach our team and fix recurring problems.' },
    pages: [
      page('', [
        single('Was your issue resolved?', ['Yes, completely', 'Partly', 'No, not yet'], { required: true, key: 'resolved' }),
        dropdown('How did you contact us?', ['Email', 'Live chat', 'Phone', 'Help center form', 'Social media']),
        rating('How would you rate the support you received?', { scale: 5, required: true, minLabel: 'Very poor', maxLabel: 'Excellent' }),
        matrix('How would you rate the support agent on these?', ['Friendliness', 'Knowledge', 'Speed of response', 'Clarity of explanation'], 'quality5'),
        long('What is still unresolved, and how can we help?', { showIf: ['resolved', 'isNot', 'Yes, completely'] }),
        note('Want us to get back to you?', 'Leave your details below and a team member will reach out. This is optional.'),
        contact('Your contact details', ['name', 'email']),
      ]),
    ],
  },
];
