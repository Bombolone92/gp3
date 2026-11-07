import { describe, it, expect } from 'vitest';
import {
  applySubject,
  buildJobPageHtml,
  buildRobotsTxt,
  buildSiteIndexHtml,
  buildSitemapXml,
  descriptionHtml,
  escapeHtml,
  jobMetaDescription,
  jobPostingJsonLd,
  parseApplicationEmail,
  subdomainBase,
} from '../src/core/jobpage.js';

const job = {
  id: 'job_1',
  title: 'Senior Engineer',
  department: 'Engineering',
  location: 'Berlin',
  workMode: 'Hybrid',
  type: 'Full-time',
  salaryMin: 90000,
  salaryMax: 120000,
  currency: 'EUR',
  description: 'Build things.\n\nWhat you will do\n- Ship code\n- Review PRs',
};

describe('escapeHtml', () => {
  it('escapes the five HTML specials', () => {
    expect(escapeHtml(`<img src=x onerror="alert('1')" & more>`)).toBe(
      '&lt;img src=x onerror=&quot;alert(&#39;1&#39;)&quot; &amp; more&gt;'
    );
  });
});

describe('descriptionHtml', () => {
  it('renders paragraphs and bullet lists, escaped', () => {
    const html = descriptionHtml('Intro <b>bold</b>\n\nList:\n- one\n- two');
    expect(html).toContain('<p>Intro &lt;b&gt;bold&lt;/b&gt;</p>');
    expect(html).toContain('<ul><li>one</li><li>two</li></ul>');
  });

  it('is empty for empty input', () => {
    expect(descriptionHtml('')).toBe('');
  });
});

describe('buildJobPageHtml', () => {
  it('includes the role, company, meta, salary, and description', () => {
    const html = buildJobPageHtml(job, { companyName: 'Acme', applyEmail: 'jobs@acme.com' });
    expect(html).toContain('<title>Senior Engineer · Acme</title>');
    expect(html).toContain('<h1>Senior Engineer</h1>');
    expect(html).toContain('Engineering · Berlin · Hybrid · Full-time');
    expect(html).toContain('per year');
    expect(html).toContain('<li>Ship code</li>');
  });

  it('renders the apply form wired to a structured mailto', () => {
    const html = buildJobPageHtml(job, { companyName: 'Acme', applyEmail: 'jobs@acme.com' });
    expect(applySubject(job)).toBe('Application: Senior Engineer [job_1]');
    expect(html).toContain('id="apply-form"');
    expect(html).toContain('Apply by email');
    // The inline script carries the subject token and apply address.
    expect(html).toContain(JSON.stringify(applySubject(job)));
    expect(html).toContain('jobs@acme.com');
  });

  it('keeps a way to apply when the mailto hand-off goes nowhere', () => {
    const html = buildJobPageHtml(job, { companyName: 'Acme', applyEmail: 'jobs@acme.com' });
    // Hidden until the submit has been attempted, then revealed by the
    // page's own script: a browser with no mail app registered swallows
    // the click silently.
    expect(html).toContain('data-apply-fallback hidden');
    expect(html).toContain('<a href="mailto:jobs@acme.com">jobs@acme.com</a>');
    expect(html).toContain("querySelector('[data-apply-fallback]')");
  });

  it('neutralizes script injection through job fields', () => {
    const hostile = {
      ...job,
      title: '<script>alert(1)</script>',
      description: '"><img src=x onerror=alert(2)>',
    };
    const html = buildJobPageHtml(hostile, { companyName: '<b>Evil</b>', applyEmail: 'a@b.com' });
    expect(html).not.toContain('<script>alert(1)');
    expect(html).not.toContain('<img src=x');
    expect(html).not.toContain('<b>Evil</b>');
  });

  it('cannot break out of the inline script through a hostile title', () => {
    const hostile = { ...job, title: 'X</script><script>alert(3)</script>' };
    const html = buildJobPageHtml(hostile, { companyName: 'Acme', applyEmail: 'a@b.com' });
    expect(html).not.toContain('</script><script>alert(3)');
  });

  it('omits the apply block without an email', () => {
    const html = buildJobPageHtml(job, { companyName: 'Acme', applyEmail: '' });
    expect(html).not.toContain('Apply by email');
  });

  // A restored backup can put anything in settings.companyName; the
  // builders must render it, not throw out of Publish and Unpublish.
  it('renders a company name that is not a string', () => {
    expect(buildJobPageHtml(job, { companyName: null })).toContain('We are hiring');
    expect(buildJobPageHtml(job, { companyName: 42 })).toContain('42');
    expect(buildSiteIndexHtml([job], { companyName: null })).toContain('We are hiring');
  });
});

describe('a closing date the page enforces itself', () => {
  const closing = { ...job, closesOn: '2026-09-30' };

  it('marks the open state and carries the closed copy for later', () => {
    const html = buildJobPageHtml(closing, { companyName: 'Acme', applyEmail: 'jobs@acme.com' });
    // The page is a static file — nothing rewrites it when the date
    // passes — so it ships both readings and the script that swaps them.
    expect(html).toContain('<p class="closes" data-when-open>Applications close on September 30, 2026.</p>');
    expect(html).toContain('<section class="apply-section" data-when-open>');
    expect(html).toContain(
      '<p class="closes" data-when-closed hidden>Applications for this role closed on September 30, 2026.</p>'
    );
    expect(html).toContain('var CLOSES = "2026-09-30"');
  });

  it('leaves a posting with no closing date exactly as it was', () => {
    const html = buildJobPageHtml(job, { companyName: 'Acme', applyEmail: 'jobs@acme.com' });
    expect(html).not.toContain('data-when-open');
    expect(html).not.toContain('data-when-closed');
    expect(html).not.toContain('CLOSES');
    expect(html).toContain('<section class="apply-section">');
  });

  it('still swaps the line on a page with no apply form', () => {
    const html = buildJobPageHtml(closing, { companyName: 'Acme' });
    expect(html).not.toContain('apply-form');
    expect(html).toContain('data-when-closed');
    expect(html).toContain('var CLOSES = "2026-09-30"');
  });
});

describe('buildSiteIndexHtml', () => {
  it('lists published jobs with escaped titles and links', () => {
    const html = buildSiteIndexHtml([{ id: 'j1', title: 'A <Role>', location: 'Berlin' }], { companyName: 'Acme' });
    expect(html).toContain('href="./j1.html"');
    expect(html).toContain('A &lt;Role&gt;');
    expect(html).toContain('Berlin');
  });

  it('has a friendly empty state', () => {
    const html = buildSiteIndexHtml([], {});
    expect(html).toContain('No open roles right now');
    expect(html).not.toContain('hidden>No open roles');
    // Nothing to close, so nothing to script.
    expect(html).not.toContain('data-closes');
  });

  it('gives a closing role its date and the script that retires the row', () => {
    const html = buildSiteIndexHtml([
      { id: 'j1', title: 'Open forever' },
      { id: 'j2', title: 'Closing', closesOn: '2026-09-30' },
    ]);
    // The index is a static file, like the job pages: without this the
    // front door kept advertising a role whose own page had already
    // stopped taking applications.
    expect(html).toContain('<li data-closes="2026-09-30">');
    expect(html).toContain('<li><a href="./j1.html">');
    expect(html).toContain("querySelectorAll('li[data-closes]')");
    // The empty state ships hidden, ready for the script to reveal it
    // once every listed role has closed.
    expect(html).toContain('<p class="meta" data-empty hidden>');
  });

  it('leaves an index of open-ended roles exactly as it was', () => {
    const html = buildSiteIndexHtml([{ id: 'j1', title: 'Open forever' }]);
    expect(html).not.toContain('data-closes');
    expect(html).not.toContain('<script>');
  });

  it('ignores a half-typed closing date rather than hiding the row at once', () => {
    const html = buildSiteIndexHtml([{ id: 'j1', title: 'Role', closesOn: '2026-09' }]);
    expect(html).not.toContain('data-closes');
  });
});

describe('parseApplicationEmail', () => {
  const structured = `Subject: Application: Senior Engineer [job_1]

New application: Senior Engineer

Name: Jane Doe
Email: jane@example.com
Phone: +1 555 000 1234
Link: https://linkedin.com/in/janedoe

Notes:
I shipped the billing rewrite at Acme.
Happy to share references.

Job: Senior Engineer [job_1]`;

  it('parses every field and the job token from a structured email', () => {
    expect(parseApplicationEmail(structured)).toEqual({
      jobId: 'job_1',
      name: 'Jane Doe',
      email: 'jane@example.com',
      phone: '+1 555 000 1234',
      link: 'https://linkedin.com/in/janedoe',
      notes: 'I shipped the billing rewrite at Acme.\nHappy to share references.',
      answers: [],
    });
  });

  it('parses the body alone (no subject line) via the footer token', () => {
    const bodyOnly = structured.split('\n').slice(2).join('\n');
    expect(parseApplicationEmail(bodyOnly).jobId).toBe('job_1');
  });

  it('routes by the trailing footer token, not one typed into the note', () => {
    // The applicant's free text sits above the footer the page appends,
    // so a "[job_…]" pasted into the note must not win over the real one.
    const spoofed = `New application: Designer

Name: Mallory
Email: mallory@example.com

Notes:
Please consider me [job_frontend] thanks!

Job: Designer [job_designer]`;
    expect(parseApplicationEmail(spoofed).jobId).toBe('job_designer');
  });

  it('handles CRLF line endings and missing optional fields', () => {
    const parsed = parseApplicationEmail('Name: Bo\r\nEmail: bo@x.io\r\n\r\nJob: X [job_9]\r\n');
    expect(parsed).toMatchObject({ jobId: 'job_9', name: 'Bo', email: 'bo@x.io', phone: '', link: '', notes: '' });
  });

  it('falls back to From: headers and bare addresses in freeform email', () => {
    const parsed = parseApplicationEmail(
      'From: "Sam Chen" <sam@chen.dev>\nTo: jobs@acme.com\n\nHi, I want to apply for the engineer role!'
    );
    expect(parsed.name).toBe('Sam Chen');
    expect(parsed.email).toBe('sam@chen.dev');
    expect(parsed.jobId).toBeNull();
  });

  it('returns empty fields for unusable text', () => {
    expect(parseApplicationEmail('')).toEqual({ jobId: null, name: '', email: '', phone: '', link: '', notes: '', answers: [] });
  });
});

describe('subdomainBase', () => {
  it('slugifies company names with a fallback', () => {
    expect(subdomainBase('Lighthouse Labs GmbH')).toBe('lighthouse-labs-gmbh');
    expect(subdomainBase('  ')).toBe('jobs');
    expect(subdomainBase('日本語')).toBe('jobs');
  });
});

describe('screening questions on the job page', () => {
  const asked = {
    ...job,
    screeningQuestions: [
      { id: 'q1', label: 'Authorized to work in Germany?', kind: 'yesno', required: true, mustHave: true },
      { id: 'q2', label: 'Notice period', kind: 'short', required: false },
      { id: 'q3', label: 'Years with Rust', kind: 'choice', required: true, options: ['0–2', '3–5', '5+'] },
      { id: 'q4', label: 'Why this role?', kind: 'long', required: false },
    ],
  };

  it('renders one control per question, with the right kind', () => {
    const html = buildJobPageHtml(asked, { companyName: 'Acme', applyEmail: 'jobs@acme.com' });
    expect(html).toContain('Authorized to work in Germany?');
    // Required questions carry `required`; optional ones say so instead.
    expect(html).toContain('<select name="q0" required>');
    expect(html).toContain('<option>Yes</option><option>No</option>');
    expect(html).toContain('Notice period <span class="opt">(optional)</span>');
    expect(html).toContain('<option>3–5</option>');
    expect(html).toContain('<textarea name="q3" maxlength="600"></textarea>');
    // The submit handler needs the labels to write the Q: lines.
    expect(html).toContain('{n:"q0",l:"Authorized to work in Germany?"}');
  });

  it('escapes hostile question wording and options', () => {
    const html = buildJobPageHtml(
      { ...job, screeningQuestions: [{ id: 'q1', label: '</script><img src=x>', kind: 'choice', options: ['"><b>x</b>'] }] },
      { companyName: 'Acme', applyEmail: 'a@b.com' }
    );
    expect(html).not.toContain('<img src=x');
    expect(html).not.toContain('<b>x</b>');
    expect(html).not.toContain('</script><img');
  });

  it('asks nothing extra when the job has no questions', () => {
    const html = buildJobPageHtml(job, { companyName: 'Acme', applyEmail: 'a@b.com' });
    expect(html).not.toContain('<div class="apply-questions">');
    expect(html).toContain('var QUESTIONS = [];');
  });
});

describe('parseApplicationEmail with screening answers', () => {
  it('reads Q/A pairs back, keeping notes and fields intact', () => {
    const parsed = parseApplicationEmail(`New application: Senior Engineer

Name: Jane Doe
Email: jane@example.com

Q: Authorized to work in Germany?
A: Yes

Q: Notice period
A: 2 months

Notes:
Available from May.

Job: Senior Engineer [job_1]`);
    expect(parsed.answers).toEqual([
      { label: 'Authorized to work in Germany?', answer: 'Yes' },
      { label: 'Notice period', answer: '2 months' },
    ]);
    expect(parsed.name).toBe('Jane Doe');
    expect(parsed.notes).toBe('Available from May.');
    expect(parsed.jobId).toBe('job_1');
  });

  it('keeps a multi-line answer together and closes the last one', () => {
    const parsed = parseApplicationEmail(`Name: Bo

Q: Why this role?
A: I like the product.
I have shipped the same thing twice.`);
    expect(parsed.answers).toEqual([
      { label: 'Why this role?', answer: 'I like the product.\nI have shipped the same thing twice.' },
    ]);
    expect(parsed.notes).toBe('');
  });

  it('keeps the paragraphs inside one answer, and still closes it at the next block', () => {
    // The answer box takes 600 characters; a blank line is a paragraph
    // break in it, not the end of the answer.
    const parsed = parseApplicationEmail(`Name: Bo

Q: Tell us about a project
A: I built a cache.

It was fast.
Very fast.

Q: Authorized to work here?
A: No

Notes:
Available in May.

Job: X [job_2]`);
    expect(parsed.answers).toEqual([
      { label: 'Tell us about a project', answer: 'I built a cache.\n\nIt was fast.\nVery fast.' },
      { label: 'Authorized to work here?', answer: 'No' },
    ]);
    expect(parsed.notes).toBe('Available in May.');
    expect(parsed.jobId).toBe('job_2');
  });

  it('drops a question that came back unanswered', () => {
    const parsed = parseApplicationEmail('Name: Bo\n\nQ: Notice period\nA:  \n\nJob: X [job_2]');
    expect(parsed.answers).toEqual([]);
  });

  it('handles CRLF answers', () => {
    const parsed = parseApplicationEmail('Name: Bo\r\n\r\nQ: Salary expectation\r\nA: 90k\r\n\r\nJob: X [job_2]');
    expect(parsed.answers).toEqual([{ label: 'Salary expectation', answer: '90k' }]);
  });
});

describe('findability', () => {
  const posted = { ...job, id: 'job_1', createdAt: '2026-07-02T10:00:00.000Z', closesOn: '2026-09-30' };
  const site = 'https://acme-jobs-ab12.puter.site';

  it('emits a JobPosting from the fields the app stores', () => {
    const data = jobPostingJsonLd(posted, { companyName: 'Acme', siteUrl: site });
    expect(data['@type']).toBe('JobPosting');
    expect(data.title).toBe('Senior Engineer');
    expect(data.hiringOrganization).toEqual({ '@type': 'Organization', name: 'Acme', sameAs: `${site}/` });
    expect(data.datePosted).toBe('2026-07-02');
    // End of the closing day: a posting is served all day it closes on.
    expect(data.validThrough).toBe('2026-09-30T23:59:59');
    expect(data.employmentType).toBe('FULL_TIME');
    expect(data.url).toBe(`${site}/job_1.html`);
    expect(data.jobLocation).toEqual({
      '@type': 'Place',
      address: { '@type': 'PostalAddress', addressLocality: 'Berlin' },
    });
    expect(data.baseSalary).toEqual({
      '@type': 'MonetaryAmount',
      currency: 'EUR',
      value: { '@type': 'QuantitativeValue', minValue: 90000, maxValue: 120000, unitText: 'YEAR' },
    });
  });

  it('describes a remote role as one, with where applicants may live', () => {
    const data = jobPostingJsonLd({ ...posted, workMode: 'Remote', location: 'Germany' }, { companyName: 'Acme' });
    expect(data.jobLocationType).toBe('TELECOMMUTE');
    expect(data.applicantLocationRequirements).toEqual({ '@type': 'Country', name: 'Germany' });
    expect(data.jobLocation).toBeUndefined();
  });

  it('leaves out what the job does not say', () => {
    const data = jobPostingJsonLd({ id: 'j1', title: 'Engineer' }, {});
    expect(data.datePosted).toBeUndefined();
    expect(data.validThrough).toBeUndefined();
    expect(data.baseSalary).toBeUndefined();
    expect(data.jobLocation).toBeUndefined();
    expect(data.url).toBeUndefined();
    expect(data.hiringOrganization.name).toBe('We are hiring');
  });

  it('keeps a half-typed closing date out of validThrough', () => {
    expect(jobPostingJsonLd({ ...posted, closesOn: '2026-09' }, {}).validThrough).toBeUndefined();
  });

  it('reports only one salary bound when only one is set', () => {
    const data = jobPostingJsonLd({ ...posted, salaryMin: null }, {});
    expect(data.baseSalary.value).toEqual({ '@type': 'QuantitativeValue', maxValue: 120000, unitText: 'YEAR' });
  });

  it('puts the canonical, card, and structured data in the page head', () => {
    const html = buildJobPageHtml(posted, { companyName: 'Acme', applyEmail: 'jobs@acme.com', siteUrl: `${site}/` });
    expect(html).toContain(`<link rel="canonical" href="${site}/job_1.html">`);
    expect(html).toContain('<meta property="og:site_name" content="Acme">');
    expect(html).toContain(`<meta property="og:url" content="${site}/job_1.html">`);
    expect(html).toContain('<meta name="twitter:card" content="summary">');
    expect(html).toContain('<script type="application/ld+json">');
    expect(html).toContain('"@type":"JobPosting"');
    // The closing date is stated to the applicant too, not only to crawlers.
    expect(html).toContain('Applications close on September 30, 2026.');
  });

  it('leaves absolute URLs out before the site has an address', () => {
    const html = buildJobPageHtml(posted, { companyName: 'Acme', applyEmail: 'jobs@acme.com' });
    expect(html).not.toContain('rel="canonical"');
    expect(html).not.toContain('og:url');
    expect(html).toContain('<meta property="og:title"');
  });

  it('cannot break out of the JSON-LD script element', () => {
    const html = buildJobPageHtml({ ...posted, title: '</script><script>alert(1)</script>' }, { companyName: 'Acme' });
    expect(html).not.toContain('</script><script>alert(1)');
    expect(html).toContain('\\u003c/script');
  });

  it('summarizes a job for search results and link previews', () => {
    expect(jobMetaDescription(job, 'Acme')).toBe(
      'Senior Engineer at Acme · Berlin · Hybrid · Full-time · Build things. What you will do Ship code Review PRs'
    );
    expect(jobMetaDescription({ title: 'Engineer' }, '')).toBe('Engineer at We are hiring');
    expect(jobMetaDescription({ title: 'Engineer', description: 'x'.repeat(400) }, 'Acme').length).toBeLessThanOrEqual(301);
  });

  it('gives the index a canonical and a summary of what is open', () => {
    const html = buildSiteIndexHtml([job, { id: 'j2', title: 'Designer' }], { companyName: 'Acme', siteUrl: site });
    expect(html).toContain(`<link rel="canonical" href="${site}/">`);
    expect(html).toContain('content="2 open roles at Acme: Senior Engineer, Designer"');
    expect(buildSiteIndexHtml([], { companyName: 'Acme', siteUrl: site })).toContain('content="Open roles at Acme."');
  });

  it('lists the index and every published page in the sitemap', () => {
    const xml = buildSitemapXml([{ id: 'job_1' }, { id: 'job_2' }], { siteUrl: `${site}/` });
    expect(xml).toContain('<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">');
    expect(xml).toContain(`<url><loc>${site}/</loc></url>`);
    expect(xml).toContain(`<url><loc>${site}/job_2.html</loc></url>`);
    // Nothing to point at without an address: the caller skips the write.
    expect(buildSitemapXml([{ id: 'job_1' }], {})).toBe('');
  });

  it('writes a crawlable robots.txt pointing at the sitemap', () => {
    expect(buildRobotsTxt({ siteUrl: site })).toBe(`User-agent: *\nAllow: /\nSitemap: ${site}/sitemap.xml\n`);
    expect(buildRobotsTxt({})).toBe('User-agent: *\nAllow: /\n');
  });
});
