/** Education templates. */
import { single, multi, rating, matrix, long, text, page, dropdown, slider } from './dsl.js';

export default [
  {
    id: 'course-evaluation',
    name: 'Course evaluation',
    category: 'education',
    summary: 'End-of-term feedback on content, teaching, and workload.',
    theme: 'sand',
    intro: 'Your feedback is anonymous and helps improve this course for future students.',
    thankYou: { title: 'Thank you', message: 'Your instructor will see the combined results after grades are posted.' },
    pages: [
      page('The course', [
        text('Which course are you evaluating?', { required: true }),
        rating('Overall, how would you rate this course?', { scale: 5, required: true }),
        matrix('How much do you agree?', [
          'The course goals were clear',
          'The materials helped me learn',
          'Assignments matched what we covered',
          'Grading was fair',
        ], 'agree5'),
        slider('About how many hours per week did you spend on this course outside class?', { min: 0, max: 20, step: 1, minLabel: '0 hours', maxLabel: '20 or more' }),
      ]),
      page('The teaching', [
        matrix('The instructor...', ['Explained ideas clearly', 'Was well prepared', 'Encouraged questions', 'Gave helpful feedback', 'Was available outside class'], 'agree5'),
        long('What helped your learning the most?'),
        long('What would you change about this course?'),
      ]),
    ],
  },
  {
    id: 'student-wellbeing',
    name: 'Student wellbeing check-in',
    category: 'education',
    summary: 'A gentle, confidential check-in on how students are doing.',
    theme: 'meadow',
    options: { format: 'focus' },
    intro: 'This check-in is confidential. There are no right or wrong answers, and you can skip any question.',
    thankYou: { title: 'Thanks for checking in', message: 'If you would like to talk to someone, the student support office is always open to you.' },
    pages: [
      page('', [
        single('How have you been feeling this week?', ['Great', 'Good', 'Okay', 'Not great', 'Struggling'], { key: 'mood' }),
        matrix('How often have you felt this way in the last two weeks?', [
          'Able to keep up with schoolwork',
          'Connected to friends',
          'Rested and energetic',
          'Worried or stressed',
        ], 'frequency5'),
        single('Is there an adult at school you feel you can talk to?', ['Yes', 'Not sure', 'No']),
        single('Would you like someone from student support to contact you?', ['Yes, please', 'No, thank you'], { key: 'contact' }),
        text('What is the best way to reach you?', { showIf: ['contact', 'is', 'Yes, please'], placeholder: 'Email or phone' }),
        long('Is there anything else you would like us to know?'),
      ]),
    ],
  },
  {
    id: 'parent-feedback',
    name: 'Parent and guardian feedback',
    category: 'education',
    summary: 'Ask families about communication, learning, and school life.',
    theme: 'forest',
    intro: 'We value your partnership. Please share your views on the school year so far.',
    thankYou: { title: 'Thank you', message: 'We will share a summary of the results in the next newsletter.' },
    pages: [
      page('', [
        dropdown('Which grade is your child in?', ['Kindergarten', 'Grade 1', 'Grade 2', 'Grade 3', 'Grade 4', 'Grade 5', 'Grade 6', 'Grade 7', 'Grade 8'], { required: true }),
        matrix('How much do you agree?', [
          'My child feels safe at school',
          'My child enjoys learning',
          'Teachers keep me informed about progress',
          'The school responds to my concerns',
        ], 'agree5', { required: true }),
        multi('How would you like to hear from the school?', ['Email', 'Text message', 'School app', 'Printed letters', 'Meetings in person']),
        single('How satisfied are you with homework levels?', ['Too much', 'About right', 'Too little', 'Not sure']),
        long('What is one thing the school could do better?'),
      ]),
    ],
  },
];
