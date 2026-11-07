import { beforeAll, describe, expect, it } from 'vitest';
import { PDFDocument, PDFHexString, PDFName, PDFNumber } from 'pdf-lib';
import {
  authenticateOwner,
  documentAccess,
  requireDocumentAccess,
  aesCbcDecrypt,
  aesCbcEncrypt,
  openedProtection,
  protectPdf,
  sameEncryptionPassword,
  toHex,
  unlockPdf,
} from '../src/core/security.js';

const name = PDFName.of;
const denied = { print: false, copy: false, annotate: false, edit: false };
let encrypted, fileKey;
beforeAll(async () => {
  const doc = await PDFDocument.create();
  doc.addPage().drawText('Restricted content');
  encrypted = await protectPdf(await doc.save(), {
    open: 'reader',
    permissions: 'owner',
    allow: denied,
  });
  fileKey = (await unlockPdf(encrypted, 'owner')).encryption.fileKey;
});

async function tamper(change) {
  const doc = await PDFDocument.load(encrypted, { ignoreEncryption: true, updateMetadata: false });
  const dict = doc.context.lookup(doc.context.trailerInfo.Encrypt);
  change(dict, doc);
  return doc.save({ useObjectStreams: false, updateFieldAppearances: false });
}
function changePerms(dict, change) {
  const plain = aesCbcDecrypt(fileKey, new Uint8Array(16), dict.lookup(name('Perms')).asBytes());
  change(plain);
  dict.set(
    name('Perms'),
    PDFHexString.of(toHex(aesCbcEncrypt(fileKey, new Uint8Array(16), plain))),
  );
}

describe('encrypted permissions validation', () => {
  const cases = [
    ['missing permission flags', (dict) => dict.delete(name('P'))],
    [
      'fractional permission flags',
      (dict) => dict.set(name('P'), PDFNumber.of(dict.lookup(name('P')).asNumber() - 0.5)),
    ],
    [
      'out-of-range permission flags',
      (dict) => dict.set(name('P'), PDFNumber.of(dict.lookup(name('P')).asNumber() + 0x100000000)),
    ],
    ['wrong metadata type', (dict) => dict.set(name('EncryptMetadata'), PDFNumber.of(1))],
    ['missing block', (dict) => dict.delete(name('Perms'))],
    ['wrong block type', (dict) => dict.set(name('Perms'), PDFNumber.of(0))],
    ['zero block', (dict) => dict.set(name('Perms'), PDFHexString.of('00'.repeat(16)))],
    ['short block', (dict) => dict.set(name('Perms'), PDFHexString.of('00'.repeat(15)))],
    ['long block', (dict) => dict.set(name('Perms'), PDFHexString.of('00'.repeat(17)))],
    [
      'wrong marker',
      (dict) =>
        changePerms(dict, (plain) => {
          plain[9] = 0;
        }),
    ],
    ['mismatched flags', (dict) => dict.set(name('P'), PDFNumber.of(-4))],
    [
      'mismatched metadata',
      (dict, doc) => dict.set(name('EncryptMetadata'), doc.context.obj(false)),
    ],
    [
      'invalid metadata marker',
      (dict) =>
        changePerms(dict, (plain) => {
          plain[8] = 0;
        }),
    ],
    [
      'invalid reserved permissions',
      (dict) =>
        changePerms(dict, (plain) => {
          plain[4] = 0;
        }),
    ],
  ];
  for (const [label, change] of cases) {
    it(`rejects a revision-6 ${label} for either password`, async () => {
      const bytes = await tamper(change);
      for (const password of ['reader', 'owner']) {
        await expect(unlockPdf(bytes, password)).rejects.toThrow(/invalid.*permissions/i);
      }
    });
  }
  it('accepts matching unencrypted-metadata permissions and arbitrary random bytes', async () => {
    const bytes = await tamper((dict, doc) => {
      dict.set(name('EncryptMetadata'), doc.context.obj(false));
      changePerms(dict, (plain) => {
        plain[8] = 0x46;
        plain.fill(0, 12);
      });
    });
    expect((await unlockPdf(bytes, 'reader')).owner).toBe(false);
    expect((await unlockPdf(bytes, 'owner')).owner).toBe(true);
  });
});

describe('authenticated roles', () => {
  it('retains user and owner roles alongside the original export protection', async () => {
    for (const [password, owner] of [
      ['reader', false],
      ['owner', true],
    ]) {
      const opened = await unlockPdf(encrypted, password);
      const protection = openedProtection(opened, password);
      expect(protection.owner).toBe(owner);
      expect(protection.original).toBe(opened.encryption);
      expect(protection.allow).toEqual(denied);
    }
  });
  it('grants owner access when one password authenticates both roles', async () => {
    const doc = await PDFDocument.create();
    doc.addPage();
    const bytes = await protectPdf(await doc.save(), {
      open: 'same',
      permissions: 'same',
      allow: denied,
    });
    expect((await unlockPdf(bytes, 'same')).owner).toBe(true);
  });
  it.each([
    ['reader123', 'ｒｅａｄｅｒ123', true],
    ['caf\u00e9', 'cafe\u0301', true],
    ['界'.repeat(43) + 'reader', '界'.repeat(43) + 'owner', true],
    ['a'.repeat(126) + 'b', 'a'.repeat(126) + 'c', false],
    ['Reader', 'reader', false],
    ['', 'owner', false],
    // SASLprep drops soft hyphens and joiners and turns other spaces into plain spaces.
    ['secret\u00ad', 'secret', true],
    ['zero\u200dwidth', 'zerowidth', true],
    ['two\u1680words', 'two words', true],
  ])(
    'compares effective passwords consistently with authentication (%s)',
    async (open, permissions, same) => {
      expect(sameEncryptionPassword(open, permissions)).toBe(same);
      const doc = await PDFDocument.create();
      doc.addPage();
      const bytes = await protectPdf(await doc.save(), { open, permissions, allow: denied });
      expect((await unlockPdf(bytes, open)).owner).toBe(same);
      expect((await unlockPdf(bytes, permissions)).owner).toBe(true);
    },
  );
});

it('opens a revision 6 file whose writer prepared the password with SASLprep', async () => {
  const doc = await PDFDocument.create();
  doc.addPage();
  const bytes = await protectPdf(await doc.save(), { open: 'password' });
  expect((await unlockPdf(bytes, 'pass\u00adword')).bytes.length).toBeGreaterThan(0);
  expect(sameEncryptionPassword('\u00ad\ufeff', '')).toBe(true);
});

describe('applicable document permissions', () => {
  const reader = (P, R = 6) => ({ owner: false, original: { security: { P, R } } });
  it('keeps independent form, annotation, assembly, and content permissions separate', () => {
    const forms = reader(0x100);
    expect(documentAccess(forms)).toMatchObject({
      fill: true,
      annotate: false,
      edit: false,
      assemble: false,
    });
    expect(() => requireDocumentAccess(forms, 'fill')).not.toThrow();
    expect(() => requireDocumentAccess(forms, 'edit')).toThrow(/editing content/);
    expect(documentAccess(reader(0x20))).toMatchObject({ annotate: true, fill: true, edit: false });
    expect(documentAccess(reader(0x400))).toMatchObject({
      assemble: true,
      edit: false,
      fill: false,
    });
    expect(documentAccess(reader(0x8))).toMatchObject({
      edit: true,
      assemble: false,
      annotate: false,
      fill: false,
    });
  });
  it('interprets the revision-2 modification and copy permissions without later bits', () => {
    expect(documentAccess(reader(0x8 | 0x10 | 0x4, 2))).toMatchObject({
      assemble: true,
      edit: true,
      accessibility: true,
      printHighQuality: true,
      fill: false,
    });
    expect(documentAccess(reader(0x100 | 0x200 | 0x400 | 0x800, 2))).toMatchObject({
      fill: false,
      assemble: false,
      accessibility: false,
      print: false,
      printHighQuality: false,
    });
  });
  it('allows accessibility independently of copying in revisions 3–5 and always in revision 6', () => {
    for (const revision of [3, 4, 5]) {
      expect(documentAccess(reader(0x200, revision))).toMatchObject({
        accessibility: true,
        copy: false,
      });
      expect(documentAccess(reader(0, revision)).accessibility).toBe(false);
    }
    expect(documentAccess(reader(0, 6))).toMatchObject({ accessibility: true, copy: false });
  });
  it('requires both printing bits for high quality in revisions 3 and later', () => {
    for (const revision of [3, 4, 5, 6]) {
      expect(documentAccess(reader(0x4, revision))).toMatchObject({
        print: true,
        printHighQuality: false,
      });
      expect(documentAccess(reader(0x800, revision))).toMatchObject({
        print: false,
        printHighQuality: false,
      });
      expect(documentAccess(reader(0x804, revision))).toMatchObject({
        print: true,
        printHighQuality: true,
      });
    }
  });
  it('gives unrestricted access to unprotected files, new protection, and authenticated owners', () => {
    for (const protection of [null, { allow: denied }, { ...reader(0), owner: true }]) {
      expect(Object.values(documentAccess(protection)).every(Boolean)).toBe(true);
    }
  });
  it('requires owner authentication to lift restrictions without changing either export password', async () => {
    const protection = openedProtection(await unlockPdf(encrypted, 'reader'), 'reader');
    await expect(authenticateOwner(protection, 'wrong')).rejects.toThrow();
    await expect(authenticateOwner(protection, 'reader')).rejects.toThrow(/permissions password/);
    expect(documentAccess(protection).edit).toBe(false);
    const elevated = await authenticateOwner(protection, 'owner');
    expect(Object.values(documentAccess(elevated)).every(Boolean)).toBe(true);
    expect(elevated.open).toBe('reader');
    expect(elevated.permissions).toBe('owner');
    expect(elevated.original).toBe(protection.original);
    const bytes = await protectPdf((await unlockPdf(encrypted, 'reader')).bytes, elevated);
    expect((await unlockPdf(bytes, 'reader')).owner).toBe(false);
    expect((await unlockPdf(bytes, 'owner')).owner).toBe(true);
    expect(openedProtection(await unlockPdf(bytes, 'reader'), 'reader').allow).toEqual(denied);
  });
});
