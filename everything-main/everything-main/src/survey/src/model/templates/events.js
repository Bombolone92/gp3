/** Event templates. */
import { single, multi, rating, nps, matrix, long, page, dropdown, contact, date, note } from './dsl.js';

export default [
  {
    id: 'event-feedback',
    name: 'Post-event feedback',
    category: 'events',
    summary: 'Hear from attendees about sessions, venue, and organization.',
    theme: 'rose',
    intro: 'Thanks for joining us! Tell us what you enjoyed and what we can do better next time.',
    thankYou: { title: 'Thanks for coming', message: 'We hope to see you at the next one.' },
    pages: [
      page('The event', [
        rating('Overall, how would you rate the event?', { scale: 5, required: true }),
        matrix('How would you rate each of these?', ['Speakers and sessions', 'Venue', 'Food and drinks', 'Networking opportunities', 'Organization and schedule'], 'quality5'),
        single('Was the event a good use of your time?', ['Yes', 'Somewhat', 'No']),
      ]),
      page('Next time', [
        nps('How likely are you to recommend this event to a colleague?'),
        single('Would you attend again?', 'yesnomaybe', { required: true }),
        multi('Which topics would you like to see next time?', ['Practical workshops', 'Industry trends', 'Case studies', 'Career development', 'Panel discussions'], {
          other: { enabled: true, label: 'Another topic' },
        }),
        long('What was the highlight of the event for you?'),
        long('What should we improve?'),
      ]),
    ],
  },
  {
    id: 'event-registration',
    name: 'Event registration',
    category: 'events',
    summary: 'Collect attendee details, session choices, and access needs.',
    theme: 'ocean',
    intro: 'Reserve your place by filling in the form below. It takes about two minutes.',
    thankYou: { title: 'You are registered', message: 'We will email your confirmation and event details shortly.' },
    pages: [
      page('Your details', [
        contact('Your contact details', ['name', 'company', 'email', 'phone'], { required: ['name', 'email'] }),
        dropdown('How did you hear about the event?', ['From a colleague', 'Email newsletter', 'Social media', 'Search engine', 'A previous event'], {
          other: { enabled: true, label: 'Somewhere else' },
        }),
      ]),
      page('Your visit', [
        single('Which days will you attend?', ['Day one only', 'Day two only', 'Both days'], { required: true }),
        multi('Which sessions are you interested in?', ['Opening keynote', 'Morning workshops', 'Afternoon panels', 'Evening reception']),
        multi('Do you have any dietary requirements?', ['Vegetarian', 'Vegan', 'Gluten free', 'Dairy free', 'Halal', 'Kosher'], {
          none: { enabled: true, label: 'No requirements' },
          other: { enabled: true, label: 'Other (please specify)' },
        }),
        long('Do you need any accessibility support to take part fully?', { placeholder: 'Optional' }),
      ]),
    ],
  },
  {
    id: 'webinar-feedback',
    name: 'Webinar feedback',
    category: 'events',
    summary: 'A short follow-up for online sessions and live streams.',
    theme: 'midnight',
    intro: 'Thanks for watching. Two minutes of your time helps us make better webinars.',
    thankYou: { title: 'Thank you', message: 'The recording and slides will be sent to registered attendees.' },
    pages: [
      page('', [
        rating('How would you rate the webinar overall?', { scale: 5, required: true }),
        single('How did you attend?', ['Live', 'Watched the recording']),
        matrix('How much do you agree?', ['The content was useful', 'The presenter was engaging', 'The length was right', 'The audio and video were clear'], 'agree5'),
        single('Did you get all your questions answered?', ['Yes', 'No, not all of them', 'I had no questions'], { key: 'answered' }),
        long('Which question would you still like answered?', { showIf: ['answered', 'is', 'No, not all of them'] }),
        multi('What would you like future webinars to cover?', ['Beginner topics', 'Advanced topics', 'Live demos', 'Customer stories', 'Q and A sessions']),
        date('What date would suit you for a follow-up session?', { date: true, time: false }),
        note('', 'You can unsubscribe from webinar invitations at any time.'),
      ]),
    ],
  },
];

