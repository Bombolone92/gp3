/** Health and community templates. */
import { single, multi, rating, nps, matrix, long, page, dropdown, ranking, text, contact } from './dsl.js';

export default [
  {
    id: 'patient-experience',
    name: 'Patient experience',
    category: 'community',
    summary: 'Ask patients about their visit, from booking to follow-up care.',
    theme: 'teal',
    intro: 'Thank you for visiting our clinic. Your answers are confidential and help us improve care for every patient.',
    thankYou: { title: 'Thank you', message: 'If you have an urgent concern about your care, please call the clinic directly.' },
    pages: [
      page('Your visit', [
        single('How did you book your appointment?', ['Online', 'By phone', 'In person', 'Someone booked it for me']),
        single('How easy was it to get an appointment when you needed one?', 'easy5'),
        matrix('How would you rate the following?', ['Waiting time', 'Friendliness of staff', 'Cleanliness', 'Time the clinician spent with you', 'Clear explanation of next steps'], 'quality5', { required: true }),
      ]),
      page('Overall', [
        nps('How likely are you to recommend our clinic to friends and family?', { required: true }),
        single('Did you feel listened to?', ['Yes, completely', 'Yes, to some extent', 'No']),
        long('Is there anything we could have done better?'),
      ]),
    ],
  },
  {
    id: 'volunteer-feedback',
    name: 'Volunteer feedback',
    category: 'community',
    summary: 'Learn what keeps volunteers motivated and how to support them.',
    theme: 'meadow',
    intro: 'Our volunteers make everything possible. Please tell us about your experience.',
    thankYou: { title: 'Thank you for all you do', message: 'We read every response and will share what we change as a result.' },
    pages: [
      page('', [
        single('How long have you volunteered with us?', ['Less than 3 months', '3 to 12 months', '1 to 3 years', 'More than 3 years']),
        rating('How satisfied are you with your volunteering experience?', { scale: 5, shape: 'heart', required: true }),
        matrix('How much do you agree?', ['I received enough training', 'I feel appreciated', 'My time is used well', 'I know who to contact with questions'], 'agree5'),
        ranking('What motivates you most to volunteer?', ['Helping the community', 'Meeting people', 'Learning new skills', 'Feeling part of a cause', 'Career experience']),
        single('How likely are you to keep volunteering next year?', 'likely5'),
        long('What would make volunteering better for you?'),
      ]),
    ],
  },
  {
    id: 'community-needs',
    name: 'Community needs assessment',
    category: 'community',
    summary: 'Find out which local services and improvements matter most to residents.',
    theme: 'sand',
    intro: 'Help us plan for the year ahead. Tell us what matters most in your neighborhood.',
    thankYou: { title: 'Thank you', message: 'Results will be presented at the next public meeting.' },
    pages: [
      page('Your neighborhood', [
        text('Which neighborhood or area do you live in?'),
        single('How long have you lived in the area?', ['Less than a year', '1 to 5 years', '6 to 10 years', 'More than 10 years']),
        matrix('How satisfied are you with these local services?', ['Parks and green spaces', 'Public transport', 'Street safety and lighting', 'Libraries and community centers', 'Waste and recycling'], 'satisfied5'),
      ]),
      page('Priorities', [
        ranking('Rank these improvements in order of importance.', ['Affordable housing', 'Youth programs', 'Road repairs', 'Support for local businesses', 'Health services']),
        multi('Which community events would you attend?', ['Farmers market', 'Cleanup days', 'Cultural festivals', 'Sports leagues', 'Town hall meetings']),
        long('What one change would most improve your neighborhood?'),
        dropdown('What is your age range?', 'age'),
        single('Would you like updates about community projects?', ['Yes', 'No'], { key: 'updates' }),
        contact('Where should we send updates?', ['name', 'email'], { required: ['email'], showIf: ['updates', 'is', 'Yes'] }),
      ]),
    ],
  },
];
