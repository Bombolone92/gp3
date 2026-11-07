import { describe, it, expect } from 'vitest'
import { contactToVCard, contactsToVCard, vCardToContacts } from './vcard.js'
import { createContact, normalizeContact } from './model.js'

const sample = createContact({
  firstName: 'Ada',
  lastName: 'Lovelace',
  company: 'Analytical Engines',
  jobTitle: 'Mathematician',
  emails: [{ label: 'Work', value: 'ada@engine.io' }],
  phones: [{ label: 'Mobile', value: '+1 555 0100' }],
  urls: [{ label: 'Website', value: 'https://ada.example' }],
  addresses: [
    {
      label: 'Home',
      country: 'US',
      street: '1600 Pennsylvania Ave',
      street2: 'Suite 2',
      city: 'Washington',
      state: 'District of Columbia',
      postalCode: '20500',
      poBox: '',
    },
  ],
  birthday: '1815-12-10',
  notes: 'Met at a talk; loves math, logic\nand poetry.',
  tags: ['pioneer', 'vip'],
})

describe('contactToVCard', () => {
  it('emits the expected core properties', () => {
    const vcf = contactToVCard(sample)
    expect(vcf).toContain('BEGIN:VCARD')
    expect(vcf).toContain('VERSION:3.0')
    expect(vcf).toContain('FN:Ada Lovelace')
    expect(vcf).toContain('N:Lovelace;Ada;;;')
    expect(vcf).toContain('ORG:Analytical Engines')
    expect(vcf).toContain('TITLE:Mathematician')
    expect(vcf).toContain('EMAIL;TYPE=WORK:ada@engine.io')
    expect(vcf).toContain('TEL;TYPE=CELL:+1 555 0100')
    expect(vcf).toContain('CATEGORIES:pioneer,vip')
    // ADR component order: PO box; line 2; street; city; ... (long lines fold,
    // so assert a prefix; the round-trip test verifies every component).
    expect(vcf).toContain('ADR;TYPE=HOME:;Suite 2;1600 Pennsylvania Ave;Washington')
    expect(vcf).toContain('END:VCARD')
  })

  it('escapes commas, semicolons, and newlines in text', () => {
    const vcf = contactToVCard(sample)
    expect(vcf).toContain('NOTE:Met at a talk\\; loves math\\, logic\\nand poetry.')
  })

  it('normalizes CR/CRLF so a carriage return cannot truncate the value', () => {
    const vcf = contactToVCard({ firstName: 'Ada', notes: 'line1\r\nline2\rline3' })
    expect(vcf).toContain('NOTE:line1\\nline2\\nline3')
    const [back] = vCardToContacts(vcf)
    expect(back.notes).toBe('line1\nline2\nline3')
  })

  it('uses CRLF line endings', () => {
    expect(contactToVCard(sample)).toContain('\r\n')
  })

  it('never folds in the middle of a surrogate pair (emoji survive export)', () => {
    // Sweep the fold boundary across an emoji run so some offset is guaranteed
    // to land mid-pair; a lone surrogate would become U+FFFD in the saved file.
    for (let pad = 60; pad <= 76; pad++) {
      const notes = 'x'.repeat(pad) + '😀🎉👍 end'
      const vcf = contactToVCard({ firstName: 'Emo', notes })
      expect(vcf).not.toMatch(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/) // no lone high surrogate
      expect(vcf).not.toMatch(/(^|[^\uD800-\uDBFF])[\uDC00-\uDFFF]/) // no lone low surrogate
      const [back] = vCardToContacts(vcf)
      expect(back.notes).toBe(notes)
    }
  })
})

describe('round trip', () => {
  it('preserves the fields this app supports', () => {
    const [back] = vCardToContacts(contactToVCard(sample))
    expect(back.firstName).toBe('Ada')
    expect(back.lastName).toBe('Lovelace')
    expect(back.company).toBe('Analytical Engines')
    expect(back.jobTitle).toBe('Mathematician')
    expect(back.emails).toEqual([{ label: 'Work', value: 'ada@engine.io' }])
    expect(back.phones).toEqual([{ label: 'Mobile', value: '+1 555 0100' }])
    expect(back.urls).toEqual([{ label: 'Website', value: 'https://ada.example' }])
    expect(back.addresses).toEqual([
      {
        label: 'Home',
        country: 'US',
        street: '1600 Pennsylvania Ave',
        street2: 'Suite 2',
        city: 'Washington',
        state: 'District of Columbia',
        postalCode: '20500',
        poBox: '',
      },
    ])
    expect(back.birthday).toBe('1815-12-10')
    expect(back.notes).toBe('Met at a talk; loves math, logic\nand poetry.')
    expect(back.tags).toEqual(['pioneer', 'vip'])
  })
})

describe('vCardToContacts', () => {
  it('derives first/last from FN when N is absent', () => {
    const [c] = vCardToContacts('BEGIN:VCARD\r\nVERSION:3.0\r\nFN:Grace Hopper\r\nEND:VCARD')
    expect(c.firstName).toBe('Grace')
    expect(c.lastName).toBe('Hopper')
  })

  it('unfolds folded lines', () => {
    const folded =
      'BEGIN:VCARD\r\nVERSION:3.0\r\nFN:Test\r\nNOTE:This is a very long\r\n  folded note value\r\nEND:VCARD'
    const [c] = vCardToContacts(folded)
    expect(c.notes).toBe('This is a very long folded note value')
  })

  it('maps standard TYPE params back to labels', () => {
    const vcf =
      'BEGIN:VCARD\r\nVERSION:3.0\r\nFN:T\r\nTEL;TYPE=CELL:1\r\nTEL;TYPE=HOME:2\r\nEMAIL;TYPE=WORK:w@x.com\r\nEND:VCARD'
    const [c] = vCardToContacts(vcf)
    expect(c.phones).toEqual([
      { label: 'Mobile', value: '1' },
      { label: 'Home', value: '2' },
    ])
    expect(c.emails).toEqual([{ label: 'Work', value: 'w@x.com' }])
  })

  it('normalizes birthday wire formats from other exporters', () => {
    const card = (bday) => `BEGIN:VCARD\r\nVERSION:3.0\r\nFN:Ada\r\n${bday}\r\nEND:VCARD`
    // Apple marks a year-less birthday by pinning the year to 1604.
    expect(vCardToContacts(card('BDAY;X-APPLE-OMIT-YEAR=1604:1604-04-15'))[0].birthday).toBe('0000-04-15')
    // RFC 6350 compact and year-less forms.
    expect(vCardToContacts(card('BDAY:19900415'))[0].birthday).toBe('1990-04-15')
    expect(vCardToContacts(card('BDAY:--0415'))[0].birthday).toBe('0000-04-15')
    expect(vCardToContacts(card('BDAY:--04-15'))[0].birthday).toBe('0000-04-15')
    // A time part is dropped, in both compact and extended forms.
    expect(vCardToContacts(card('BDAY:19900415T120000'))[0].birthday).toBe('1990-04-15')
    expect(vCardToContacts(card('BDAY:1990-04-15T12:00:00Z'))[0].birthday).toBe('1990-04-15')
    // The app's own formats pass through untouched.
    expect(vCardToContacts(card('BDAY:1990-04-15'))[0].birthday).toBe('1990-04-15')
    expect(vCardToContacts(card('BDAY:0000-04-15'))[0].birthday).toBe('0000-04-15')
  })

  it('handles a group prefix on property names', () => {
    const [c] = vCardToContacts(
      'BEGIN:VCARD\r\nVERSION:3.0\r\nFN:T\r\nitem1.EMAIL;TYPE=HOME:p@x.com\r\nEND:VCARD',
    )
    expect(c.emails).toEqual([{ label: 'Personal', value: 'p@x.com' }])
  })

  it('parses multiple cards from one document', () => {
    const doc = contactsToVCard([
      normalizeContact({ firstName: 'A', lastName: 'One' }),
      normalizeContact({ firstName: 'B', lastName: 'Two' }),
    ])
    const parsed = vCardToContacts(doc)
    expect(parsed).toHaveLength(2)
    expect(parsed.map((c) => c.lastName)).toEqual(['One', 'Two'])
  })

  it('ignores stray content outside cards', () => {
    expect(vCardToContacts('garbage\r\nnot a vcard')).toEqual([])
  })

  it('decodes quoted-printable values (Android / vCard 2.1 exports)', () => {
    const vcf = [
      'BEGIN:VCARD',
      'VERSION:2.1',
      // Bare ENCODING param form, with UTF-8 octets for "Jérôme"/"Émile".
      'N;ENCODING=QUOTED-PRINTABLE;CHARSET=UTF-8:=C3=89mile;J=C3=A9r=C3=B4me;;;',
      'FN;QUOTED-PRINTABLE;CHARSET=UTF-8:J=C3=A9r=C3=B4me =C3=89mile',
      // An encoded =3B is a literal semicolon, not a component separator.
      'ORG;ENCODING=QUOTED-PRINTABLE:Caf=C3=A9=3B Bar',
      'TEL;CELL:+33 1 23 45 67 89',
      // A bare QUOTED-PRINTABLE param must not leak into the label.
      'EMAIL;QUOTED-PRINTABLE:jerome@example.com',
      'END:VCARD',
    ].join('\r\n')
    const [c] = vCardToContacts(vcf)
    expect(c.firstName).toBe('Jérôme')
    expect(c.lastName).toBe('Émile')
    expect(c.company).toBe('Café; Bar')
    expect(c.phones).toEqual([{ label: 'Mobile', value: '+33 1 23 45 67 89' }])
    expect(c.emails).toEqual([{ label: 'Personal', value: 'jerome@example.com' }])
  })

  it('joins quoted-printable soft line breaks (trailing =)', () => {
    const vcf = [
      'BEGIN:VCARD',
      'VERSION:2.1',
      'FN:Long Note',
      // QP folds with a bare '=' at end of line and no leading space on the
      // continuation — the standard unfold must not be required to catch it.
      'NOTE;ENCODING=QUOTED-PRINTABLE:This note continues =C3=A9=',
      'legantly across =',
      'two soft breaks',
      'END:VCARD',
    ].join('\r\n')
    const [c] = vCardToContacts(vcf)
    expect(c.notes).toBe('This note continues élegantly across two soft breaks')
  })

  it('round-trips a base64 photo', () => {
    const photo = 'data:image/jpeg;base64,/9j/AAAQSkZJRg'
    const vcf = contactToVCard(createContact({ firstName: 'A', photo }))
    expect(vcf).toContain('PHOTO;ENCODING=b;TYPE=JPEG:/9j/AAAQSkZJRg')
    const [back] = vCardToContacts(vcf)
    expect(back.photo).toBe(photo)
  })

  it('keeps http(s) photo URLs but drops non-image schemes and data types', () => {
    const parse = (line) =>
      vCardToContacts(['BEGIN:VCARD', 'VERSION:3.0', 'FN:P', line, 'END:VCARD'].join('\r\n'))[0]
    expect(parse('PHOTO;VALUE=uri:https://example.com/me.jpg').photo).toBe('https://example.com/me.jpg')
    expect(parse('PHOTO:data:image/png;base64,AAAA').photo).toBe('data:image/png;base64,AAAA')
    // A crafted card must not smuggle arbitrary content into the photo field.
    expect(parse('PHOTO:data:text/html;base64,PHNjcmlwdD4=').photo).toBe('')
    expect(parse('PHOTO;VALUE=uri:javascript:alert(1)').photo).toBe('')
    expect(parse('PHOTO;VALUE=uri:ftp://example.com/me.jpg').photo).toBe('')
  })

  it('round-trips a photo URL containing commas', () => {
    const photo = 'https://res.example.com/image/upload/w_100,h_100/me.jpg'
    const vcf = contactToVCard(createContact({ firstName: 'A', photo }))
    const [back] = vCardToContacts(vcf)
    expect(back.photo).toBe(photo)
  })
})
