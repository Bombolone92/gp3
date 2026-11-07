/**
 * Sample dataset for the "explore first" path. Dates are generated relative
 * to `now`, so the pipeline always has upcoming interviews, a live offer,
 * and a hire mid-onboarding, no matter when it is loaded.
 */
import { buildOnboardingPlan, DEFAULT_TEMPLATE } from './onboard.js';
import { addDays, todayISO } from '../lib/dates.js';

export function buildSeedData(now = new Date()) {
  const today = todayISO(now);
  const day = (offset) => addDays(today, offset);
  const at = (offset, hour = 10) => {
    const d = new Date(now);
    d.setDate(d.getDate() + offset);
    d.setHours(hour, 0, 0, 0);
    return d.toISOString();
  };

  const jobs = [
    {
      id: 'job_frontend',
      title: 'Senior Frontend Engineer',
      department: 'Engineering',
      location: 'Berlin, Germany',
      type: 'Full-time',
      workMode: 'Hybrid',
      description:
        'Own the customer-facing web app end to end: architecture, performance, and polish.\n\nWhat you will do\n- Ship accessible, fast UI in close partnership with design\n- Raise the bar on testing, tooling, and code review\n- Mentor mid-level engineers on the team\n\nWhat we look for\n- 5+ years building production web apps\n- Deep knowledge of the platform: DOM, CSS, performance\n- Care for detail and empathy for users',
      salaryMin: 85000,
      salaryMax: 105000,
      currency: 'EUR',
      status: 'open',
      createdAt: at(-45),
      closedAt: null,
    },
    {
      id: 'job_designer',
      title: 'Product Designer',
      department: 'Design',
      location: 'Remote, EU',
      type: 'Full-time',
      workMode: 'Remote',
      description:
        'Shape the product from first sketch to shipped feature.\n\nWhat you will do\n- Turn fuzzy problems into clear, testable flows\n- Build and maintain our design system\n- Run usability sessions and feed findings back into the roadmap\n\nWhat we look for\n- A portfolio of shipped product work\n- Fluency in modern design tooling and prototyping\n- Strong written communication',
      salaryMin: 70000,
      salaryMax: 90000,
      currency: 'EUR',
      status: 'open',
      createdAt: at(-38),
      closedAt: null,
    },
    {
      id: 'job_success',
      title: 'Customer Success Manager',
      department: 'Go-to-market',
      location: 'Amsterdam, Netherlands',
      type: 'Full-time',
      workMode: 'Onsite',
      description:
        'Be the voice of our largest customers: onboarding, adoption, and renewals.\n\nWhat you will do\n- Own a book of enterprise accounts end to end\n- Turn customer feedback into product priorities\n- Build playbooks the whole team can reuse\n\nWhat we look for\n- 3+ years in customer success or account management\n- Comfort with data: churn, adoption, and health scores\n- Calm, structured communication under pressure',
      salaryMin: 55000,
      salaryMax: 70000,
      currency: 'EUR',
      status: 'open',
      createdAt: at(-30),
      closedAt: null,
    },
    {
      id: 'job_data',
      title: 'Data Analyst',
      department: 'Engineering',
      location: 'Berlin, Germany',
      type: 'Part-time',
      workMode: 'Hybrid',
      description:
        'Help every team make better decisions with clean models and clear dashboards.',
      salaryMin: null,
      salaryMax: null,
      currency: 'EUR',
      status: 'draft',
      createdAt: at(-6),
      closedAt: null,
    },
  ];

  const candidate = (id, name, jobId, stage, createdOffset, stageOffset, extra = {}) => ({
    id,
    name,
    email: `${name.toLowerCase().replace(/[^a-z]+/g, '.')}@example.com`,
    phone: '',
    jobId,
    stage,
    status: 'active',
    source: 'Job board',
    link: '',
    notes: '',
    createdAt: at(createdOffset),
    stageChangedAt: at(stageOffset),
    history: [{ at: at(createdOffset), type: 'created', stage: 'applied' }],
    ...extra,
  });

  const candidates = [
    // Frontend pipeline
    candidate('cnd_amara', 'Amara Okafor', 'job_frontend', 'offer', -32, -4, {
      source: 'Referral',
      phone: '+49 151 2345 6789',
      link: 'https://amara.dev',
      notes: 'Referred by Lena. Led the design-system rebuild at her current company.',
    }),
    candidate('cnd_jonas', 'Jonas Weber', 'job_frontend', 'interview', -20, -6, {
      notes: 'Strong CSS specialist, active open-source maintainer.',
    }),
    candidate('cnd_priya', 'Priya Sharma', 'job_frontend', 'screen', -22, -21, {
      source: 'Sourced',
      notes: 'Currently at a fintech scale-up. Open to hybrid.',
    }),
    candidate('cnd_tomas', 'Tomas Novak', 'job_frontend', 'applied', -3, -3),
    candidate('cnd_elif', 'Elif Yilmaz', 'job_frontend', 'applied', -1, -1, {
      source: 'Career page',
    }),
    // Designer pipeline
    candidate('cnd_marta', 'Marta Silva', 'job_designer', 'interview', -15, -5, {
      source: 'Referral',
      link: 'https://martasilva.design',
      notes: 'Portfolio heavy on B2B dashboards. Great systems thinking.',
    }),
    candidate('cnd_david', 'David Osei', 'job_designer', 'screen', -9, -7),
    candidate('cnd_ines', 'Ines Fischer', 'job_designer', 'applied', -2, -2, {
      source: 'Agency',
    }),
    // Customer success pipeline
    candidate('cnd_sofia', 'Sofia Rossi', 'job_success', 'hired', -40, -7, {
      source: 'Referral',
      phone: '+31 6 1234 5678',
      notes: 'Managed a 40-account enterprise book. Starts next month.',
    }),
    candidate('cnd_lucas', 'Lucas Meyer', 'job_success', 'interview', -12, -2),
    candidate('cnd_hana', 'Hana Kim', 'job_success', 'applied', -5, -5),
    candidate('cnd_erik', 'Erik Lindqvist', 'job_success', 'screen', -18, -1, {
      status: 'rejected',
      notes: 'Great energy, but looking for a fully remote role.',
    }),
  ];

  // Timeline events that match the stages above.
  const amara = candidates[0];
  amara.history.push(
    { at: at(-25), type: 'stage', from: 'applied', to: 'screen' },
    { at: at(-18), type: 'stage', from: 'screen', to: 'interview' },
    { at: at(-4), type: 'stage', from: 'interview', to: 'offer' },
    // The offer card says "sent 3 days ago"; the timeline must carry the
    // events the real flow would have logged, or the sample profile
    // contradicts itself (the same rule as the stage moves above).
    { at: at(-4), type: 'offer', action: 'created' },
    { at: at(-3), type: 'offer', action: 'sent' }
  );
  const sofia = candidates.find((c) => c.id === 'cnd_sofia');
  sofia.history.push(
    { at: at(-34), type: 'stage', from: 'applied', to: 'screen' },
    { at: at(-27), type: 'stage', from: 'screen', to: 'interview' },
    { at: at(-14), type: 'stage', from: 'interview', to: 'offer' },
    { at: at(-11), type: 'offer', action: 'created' },
    { at: at(-10), type: 'offer', action: 'sent' },
    { at: at(-7), type: 'offer', action: 'signed' },
    { at: at(-7), type: 'stage', from: 'offer', to: 'hired' }
  );
  // Analytics reconstructs stage tenure purely from history, so every
  // candidate sitting past Applied needs the moves that got them there —
  // otherwise the sample Reports contradict the sample board, and the
  // profile timelines read "Applied" under an "Interview" header. The
  // last move lands on each candidate's stageChangedAt offset.
  const moves = {
    cnd_jonas: [[-13, 'screen'], [-6, 'interview']],
    cnd_priya: [[-21, 'screen']],
    cnd_marta: [[-10, 'screen'], [-5, 'interview']],
    cnd_david: [[-7, 'screen']],
    cnd_lucas: [[-8, 'screen'], [-2, 'interview']],
    cnd_erik: [[-10, 'screen']],
  };
  for (const [id, path] of Object.entries(moves)) {
    const c = candidates.find((x) => x.id === id);
    let from = 'applied';
    for (const [offset, to] of path) {
      c.history.push({ at: at(offset), type: 'stage', from, to });
      from = to;
    }
  }
  const erik = candidates.find((c) => c.id === 'cnd_erik');
  erik.history.push({ at: at(-1), type: 'rejected', reason: 'Needs a fully remote role.' });

  const interviews = [
    {
      id: 'itv_amara_1',
      candidateId: 'cnd_amara',
      jobId: 'job_frontend',
      date: day(-16),
      start: '10:00',
      end: '11:00',
      type: 'video',
      interviewers: ['Lena Hoffmann', 'Marc Dubois'],
      location: '',
      meetingLink: 'https://meet.example.com/amara-tech',
      notes: 'Technical deep dive: rendering performance.',
      createdAt: at(-18),
    },
    {
      id: 'itv_amara_2',
      candidateId: 'cnd_amara',
      jobId: 'job_frontend',
      date: day(-9),
      start: '14:00',
      end: '15:00',
      type: 'onsite',
      interviewers: ['Nina Braun'],
      location: 'Berlin office, room Ada',
      meetingLink: '',
      notes: 'Team fit and leadership round.',
      createdAt: at(-12),
    },
    {
      id: 'itv_jonas',
      candidateId: 'cnd_jonas',
      jobId: 'job_frontend',
      date: day(1),
      start: '11:00',
      end: '12:00',
      type: 'video',
      interviewers: ['Lena Hoffmann'],
      location: '',
      meetingLink: 'https://meet.example.com/jonas-tech',
      notes: 'Pairing session on a UI bug.',
      createdAt: at(-4),
    },
    {
      id: 'itv_marta',
      candidateId: 'cnd_marta',
      jobId: 'job_designer',
      date: day(2),
      start: '13:30',
      end: '14:30',
      type: 'video',
      interviewers: ['Nina Braun', 'Sam Carter'],
      location: '',
      meetingLink: 'https://meet.example.com/marta-portfolio',
      notes: 'Portfolio walkthrough.',
      createdAt: at(-6),
    },
    {
      id: 'itv_lucas',
      candidateId: 'cnd_lucas',
      jobId: 'job_success',
      date: day(4),
      start: '09:30',
      end: '10:15',
      type: 'phone',
      interviewers: ['Sam Carter'],
      location: '',
      meetingLink: '',
      notes: 'Role-play: renewal call with a churn-risk account.',
      createdAt: at(-2),
    },
  ];

  const scorecards = [
    {
      id: 'sc_amara_1',
      candidateId: 'cnd_amara',
      interviewId: 'itv_amara_1',
      jobId: 'job_frontend',
      author: 'Lena Hoffmann',
      ratings: { skills: 5, experience: 5, communication: 4, collaboration: 4 },
      recommendation: 'strong_yes',
      notes: 'Best systems answer I have heard for this role. Clear tradeoff thinking.',
      createdAt: at(-16, 12),
    },
    {
      id: 'sc_amara_2',
      candidateId: 'cnd_amara',
      interviewId: 'itv_amara_2',
      jobId: 'job_frontend',
      author: 'Nina Braun',
      ratings: { skills: 4, experience: 4, communication: 5, collaboration: 5 },
      recommendation: 'yes',
      notes: 'Would raise the bar for the whole team. Slight concern on people-management appetite.',
      createdAt: at(-9, 16),
    },
    {
      id: 'sc_sofia',
      candidateId: 'cnd_sofia',
      interviewId: null,
      jobId: 'job_success',
      author: 'Sam Carter',
      ratings: { skills: 4, experience: 5, communication: 5, collaboration: 4 },
      recommendation: 'strong_yes',
      notes: 'Ran the renewal role-play like she had worked here for years.',
      createdAt: at(-15),
    },
  ];

  const offers = [
    {
      id: 'off_amara',
      candidateId: 'cnd_amara',
      jobId: 'job_frontend',
      salary: 98000,
      currency: 'EUR',
      bonus: 5000,
      equity: '0.08% over 4 years',
      startDate: day(35),
      expires: day(4),
      notes: 'Includes relocation support and a learning budget.',
      status: 'sent',
      sentAt: at(-3),
      signedAt: null,
      signerName: '',
      resolvedAt: null,
      createdAt: at(-4),
    },
    {
      id: 'off_sofia',
      candidateId: 'cnd_sofia',
      jobId: 'job_success',
      salary: 64000,
      currency: 'EUR',
      bonus: null,
      equity: '',
      startDate: day(21),
      expires: null,
      notes: '',
      status: 'signed',
      sentAt: at(-10),
      signedAt: at(-7),
      signerName: 'Sofia Rossi',
      resolvedAt: at(-7),
      createdAt: at(-11),
    },
  ];

  let taskSeq = 0;
  // The template first, then the id maker: passing the maker alone left it
  // in the template's place, so it was ignored — the sample plan drew
  // random ids and the counter here never moved. The plan is stored in the
  // shape the app writes one, `templateName` included, or the sample hire
  // is the only checklist on the Onboarding view that cannot say which
  // template it came from.
  const sofiaTasks = buildOnboardingPlan(DEFAULT_TEMPLATE, () => `task_sofia_${taskSeq++}`);
  for (const task of sofiaTasks.slice(0, 4)) task.done = true;

  const onboarding = {
    cnd_sofia: { startedAt: at(-7), templateName: DEFAULT_TEMPLATE.name, tasks: sofiaTasks },
  };

  return {
    jobs,
    candidates,
    interviews,
    scorecards,
    offers,
    onboarding,
    settings: { companyName: 'Lighthouse Labs' },
  };
}
