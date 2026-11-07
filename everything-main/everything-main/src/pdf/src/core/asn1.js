/**
 * ASN.1 for certificates, CMS signatures and PKCS#12 files: a DER encoder and a decoder that
 * also accepts the BER found in real signatures (indefinite lengths, constructed strings).
 *
 * Decoded values are views over the input bytes, so the exact encoding of any element (a
 * certificate's to-be-signed part, a signature's signed attributes) is available for hashing.
 */

export class Asn1Error extends Error {
  constructor(message) {
    super(message);
    this.code = 'asn1';
  }
}

/* ---------- Bytes ---------- */
export function concatBytes(parts) {
  let length = 0;
  for (const part of parts) length += part.length;
  const out = new Uint8Array(length);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}
export const bytesEqual = (a, b) => {
  if (!a || !b || a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
};
export const hexOf = (bytes) => Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
export function bytesOfHex(hex) {
  const clean = hex.replace(/[^0-9a-fA-F]/g, '');
  const out = new Uint8Array(clean.length >> 1);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(clean.substr(i * 2, 2), 16);
  return out;
}
export function base64Of(bytes) {
  let text = '';
  for (let i = 0; i < bytes.length; i += 0x8000)
    text += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(text);
}
export function bytesOfBase64(text) {
  const binary = atob(text.replace(/[^A-Za-z0-9+/=]/g, ''));
  return Uint8Array.from(binary, (c) => c.charCodeAt(0));
}
const latin1 = (bytes) => {
  let text = '';
  for (let i = 0; i < bytes.length; i += 0x8000)
    text += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return text;
};

/* ---------- PEM ---------- */
/** Every `-----BEGIN X-----` block of a PEM text as `{ label, der }`. */
export function pemBlocks(text) {
  const blocks = [];
  const pattern = /-----BEGIN ([A-Z0-9 ]+)-----([\s\S]*?)-----END \1-----/g;
  for (const match of text.matchAll(pattern)) {
    const body = match[2].replace(/^[A-Za-z-]+:.*$/gm, '');
    blocks.push({ label: match[1], der: bytesOfBase64(body) });
  }
  return blocks;
}
export function toPem(label, der) {
  const lines = base64Of(der).match(/.{1,64}/g) || [];
  return `-----BEGIN ${label}-----\n${lines.join('\n')}\n-----END ${label}-----\n`;
}

/* ---------- Tags ---------- */
export const TAG = {
  BOOLEAN: 0x01,
  INTEGER: 0x02,
  BIT_STRING: 0x03,
  OCTET_STRING: 0x04,
  NULL: 0x05,
  OID: 0x06,
  ENUMERATED: 0x0a,
  UTF8_STRING: 0x0c,
  SEQUENCE: 0x30,
  SET: 0x31,
  NUMERIC_STRING: 0x12,
  PRINTABLE_STRING: 0x13,
  T61_STRING: 0x14,
  IA5_STRING: 0x16,
  UTC_TIME: 0x17,
  GENERALIZED_TIME: 0x18,
  VISIBLE_STRING: 0x1a,
  UNIVERSAL_STRING: 0x1c,
  BMP_STRING: 0x1e,
};

/* ---------- Decoding ---------- */
const MAX_DEPTH = 64;

export class Asn1Node {
  constructor(bytes, start, depth) {
    if (depth > MAX_DEPTH) throw new Asn1Error('ASN.1 nesting is too deep.');
    if (start >= bytes.length) throw new Asn1Error('ASN.1 data ends early.');
    this.bytes = bytes;
    this.start = start;
    this.depth = depth;
    let pos = start;
    const first = bytes[pos++];
    this.tag = first;
    this.cls = first >> 6;
    this.constructed = !!(first & 0x20);
    let number = first & 0x1f;
    if (number === 0x1f) {
      number = 0;
      let byte;
      do {
        if (pos >= bytes.length) throw new Asn1Error('ASN.1 tag ends early.');
        byte = bytes[pos++];
        number = number * 128 + (byte & 0x7f);
        if (number > 0xffffff) throw new Asn1Error('ASN.1 tag number is too large.');
      } while (byte & 0x80);
    }
    this.number = number;
    if (pos >= bytes.length) throw new Asn1Error('ASN.1 length ends early.');
    let length = bytes[pos++];
    this.indefinite = false;
    if (length === 0x80) {
      if (!this.constructed) throw new Asn1Error('Indefinite length on a primitive ASN.1 value.');
      this.indefinite = true;
    } else if (length & 0x80) {
      const count = length & 0x7f;
      if (count > 4 || pos + count > bytes.length) throw new Asn1Error('Bad ASN.1 length.');
      length = 0;
      for (let i = 0; i < count; i++) length = length * 256 + bytes[pos++];
    }
    this.valueStart = pos;
    if (this.indefinite) {
      // Children run until an end-of-contents marker (two zero bytes).
      const kids = [];
      let cursor = pos;
      for (;;) {
        if (cursor + 2 > bytes.length) throw new Asn1Error('Unterminated indefinite length.');
        if (bytes[cursor] === 0 && bytes[cursor + 1] === 0) break;
        const kid = new Asn1Node(bytes, cursor, depth + 1);
        kids.push(kid);
        cursor = kid.end;
      }
      this.valueEnd = cursor;
      this.end = cursor + 2;
      this._children = kids;
    } else {
      this.valueEnd = pos + length;
      this.end = this.valueEnd;
      if (this.end > bytes.length) throw new Asn1Error('ASN.1 value runs past the data.');
    }
  }
  /** The value bytes (for primitive types) or the encoded children. */
  get value() {
    return this.bytes.subarray(this.valueStart, this.valueEnd);
  }
  /** The complete encoding of this element, header included. */
  get der() {
    return this.bytes.subarray(this.start, this.end);
  }
  get children() {
    if (this._children) return this._children;
    const kids = [];
    if (this.constructed) {
      let cursor = this.valueStart;
      while (cursor < this.valueEnd) {
        const kid = new Asn1Node(this.bytes, cursor, this.depth + 1);
        if (kid.end > this.valueEnd) throw new Asn1Error('ASN.1 child overruns its parent.');
        kids.push(kid);
        cursor = kid.end;
      }
    }
    this._children = kids;
    return kids;
  }
  child(index) {
    const kid = this.children[index];
    if (!kid) throw new Asn1Error(`Missing ASN.1 element ${index}.`);
    return kid;
  }
  /** Universal SEQUENCE/SET or context-specific `[n]`. */
  is(tag) {
    return this.tag === tag;
  }
  isContext(number) {
    return this.cls === 2 && this.number === number;
  }
  expect(tag, what = 'value') {
    // Accept the constructed and primitive form of string types alike.
    if (this.tag !== tag && (this.tag & ~0x20) !== tag)
      throw new Asn1Error(`Unexpected ASN.1 ${what}.`);
    return this;
  }
  /** INTEGER as a BigInt (two's complement). */
  bigInt() {
    const value = this.value;
    if (!value.length) return 0n;
    let result = 0n;
    for (const byte of value) result = (result << 8n) | BigInt(byte);
    if (value[0] & 0x80) result -= 1n << BigInt(value.length * 8);
    return result;
  }
  int() {
    return Number(this.bigInt());
  }
  /** INTEGER magnitude without the sign byte (moduli, serials). */
  unsigned() {
    let value = this.value;
    while (value.length > 1 && value[0] === 0) value = value.subarray(1);
    return value;
  }
  oid() {
    return decodeOid(this.expect(TAG.OID, 'object identifier').value);
  }
  bool() {
    return this.value[0] !== 0;
  }
  /** OCTET STRING contents, joining the pieces of a BER constructed string. */
  octets() {
    if (!this.constructed) return this.value;
    return concatBytes(this.children.map((kid) => kid.octets()));
  }
  bits() {
    const value = this.octets();
    return { unused: value[0] || 0, bytes: value.subarray(1) };
  }
  string() {
    return decodeString(this.number, this.octets());
  }
  time() {
    return decodeTime(this.number, latin1(this.value));
  }
}

/** Decode the first element of `bytes`; trailing data (such as signature padding) is ignored. */
export function decodeDer(bytes, offset = 0) {
  if (!(bytes instanceof Uint8Array)) throw new Asn1Error('ASN.1 input must be bytes.');
  return new Asn1Node(bytes, offset, 0);
}

export function decodeOid(bytes) {
  if (!bytes.length) throw new Asn1Error('Empty object identifier.');
  const parts = [];
  let value = 0n;
  for (let i = 0; i < bytes.length; i++) {
    value = (value << 7n) | BigInt(bytes[i] & 0x7f);
    if (!(bytes[i] & 0x80)) {
      if (!parts.length) {
        const first = value < 40n ? 0n : value < 80n ? 1n : 2n;
        parts.push(first, value - first * 40n);
      } else parts.push(value);
      value = 0n;
    }
  }
  return parts.join('.');
}

function decodeString(number, bytes) {
  switch (number) {
    case 0x0c:
      return new TextDecoder('utf-8').decode(bytes);
    case 0x1e: {
      let text = '';
      for (let i = 0; i + 1 < bytes.length; i += 2)
        text += String.fromCharCode((bytes[i] << 8) | bytes[i + 1]);
      return text;
    }
    case 0x1c: {
      let text = '';
      for (let i = 0; i + 3 < bytes.length; i += 4) {
        const cp =
          ((bytes[i] << 24) | (bytes[i + 1] << 16) | (bytes[i + 2] << 8) | bytes[i + 3]) >>> 0;
        text += cp <= 0x10ffff ? String.fromCodePoint(cp) : '�';
      }
      return text;
    }
    default:
      // Printable, IA5, Teletex (treated as Latin-1), Visual, Numeric.
      return latin1(bytes);
  }
}

function decodeTime(number, text) {
  const match =
    number === 0x17
      ? /^(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})?(Z|[+-]\d{4})?$/.exec(text)
      : /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})?(\d{2})?(?:[.,](\d+))?(Z|[+-]\d{4})?$/.exec(text);
  if (!match) throw new Asn1Error(`Bad ASN.1 time "${text}".`);
  let year = +match[1];
  if (number === 0x17) year += year < 50 ? 2000 : 1900;
  const fraction = number === 0x17 ? 0 : match[7] ? +`0.${match[7]}` * 1000 : 0;
  const zone = number === 0x17 ? match[7] : match[8];
  let ms = Date.UTC(year, +match[2] - 1, +match[3], +match[4], +(match[5] || 0), +(match[6] || 0));
  ms += Math.round(fraction);
  if (zone && zone !== 'Z') {
    const sign = zone[0] === '-' ? -1 : 1;
    ms -= sign * (+zone.slice(1, 3) * 60 + +zone.slice(3, 5)) * 60000;
  }
  return new Date(ms);
}

/* ---------- Encoding ---------- */
function lengthBytes(length) {
  if (length < 0x80) return [length];
  const out = [];
  for (let n = length; n > 0; n = Math.floor(n / 256)) out.unshift(n & 0xff);
  return [0x80 | out.length, ...out];
}
/** A complete element from a one-byte tag and its content (bytes or a list of encodings). */
export function tlv(tag, content) {
  const body = Array.isArray(content) ? concatBytes(content) : content;
  const header = [tag, ...lengthBytes(body.length)];
  const out = new Uint8Array(header.length + body.length);
  out.set(header);
  out.set(body, header.length);
  return out;
}
export const sequence = (...items) => tlv(TAG.SEQUENCE, items.filter(Boolean));
export const set = (...items) => tlv(TAG.SET, items.filter(Boolean));
/** DER SET OF: elements sorted by their encodings. */
export function setOf(items) {
  const sorted = items
    .filter(Boolean)
    .slice()
    .sort((a, b) => {
      for (let i = 0; i < Math.min(a.length, b.length); i++) if (a[i] !== b[i]) return a[i] - b[i];
      return a.length - b.length;
    });
  return tlv(TAG.SET, sorted);
}
/** INTEGER from a number, BigInt, or unsigned big-endian bytes. */
export function integer(value) {
  if (value instanceof Uint8Array) {
    let start = 0;
    while (start < value.length - 1 && value[start] === 0) start++;
    const magnitude = value.subarray(start);
    const body = magnitude[0] & 0x80 ? concatBytes([[0], magnitude]) : magnitude;
    return tlv(TAG.INTEGER, body.length ? body : new Uint8Array(1));
  }
  let n = BigInt(value);
  const out = [];
  if (n === 0n) out.push(0);
  else if (n > 0n) {
    while (n > 0n) {
      out.unshift(Number(n & 0xffn));
      n >>= 8n;
    }
    if (out[0] & 0x80) out.unshift(0);
  } else {
    let size = 1n;
    while (n < -(1n << (size * 8n - 1n))) size++;
    let twos = n + (1n << (size * 8n));
    for (let i = 0n; i < size; i++) {
      out.unshift(Number(twos & 0xffn));
      twos >>= 8n;
    }
  }
  return tlv(TAG.INTEGER, Uint8Array.from(out));
}
export function oidBytes(dotted) {
  const parts = dotted.split('.').map((part) => BigInt(part));
  if (parts.length < 2) throw new Asn1Error(`Bad object identifier ${dotted}.`);
  const values = [parts[0] * 40n + parts[1], ...parts.slice(2)];
  const out = [];
  for (let value of values) {
    const chunk = [Number(value & 0x7fn)];
    value >>= 7n;
    while (value > 0n) {
      chunk.unshift(Number(value & 0x7fn) | 0x80);
      value >>= 7n;
    }
    out.push(...chunk);
  }
  return Uint8Array.from(out);
}
export const oid = (dotted) => tlv(TAG.OID, oidBytes(dotted));
export const octetString = (bytes) => tlv(TAG.OCTET_STRING, bytes);
export const bitString = (bytes, unused = 0) => tlv(TAG.BIT_STRING, concatBytes([[unused], bytes]));
export const nullValue = () => Uint8Array.of(TAG.NULL, 0);
export const boolean = (value) => Uint8Array.of(TAG.BOOLEAN, 1, value ? 0xff : 0);
export const utf8String = (text) => tlv(TAG.UTF8_STRING, new TextEncoder().encode(text));
export const ia5String = (text) =>
  tlv(
    TAG.IA5_STRING,
    Uint8Array.from(text, (c) => c.charCodeAt(0) & 0x7f),
  );
export const printableString = (text) =>
  tlv(
    TAG.PRINTABLE_STRING,
    Uint8Array.from(text, (c) => c.charCodeAt(0) & 0x7f),
  );
export function bmpString(text) {
  const out = new Uint8Array(text.length * 2);
  for (let i = 0; i < text.length; i++) {
    out[i * 2] = text.charCodeAt(i) >> 8;
    out[i * 2 + 1] = text.charCodeAt(i) & 0xff;
  }
  return tlv(TAG.BMP_STRING, out);
}
const two = (n) => String(n).padStart(2, '0');
function timeDigits(date, fullYear) {
  const year = date.getUTCFullYear();
  return (
    (fullYear ? String(year).padStart(4, '0') : two(year % 100)) +
    two(date.getUTCMonth() + 1) +
    two(date.getUTCDate()) +
    two(date.getUTCHours()) +
    two(date.getUTCMinutes()) +
    two(date.getUTCSeconds()) +
    'Z'
  );
}
const asciiBytes = (text) => Uint8Array.from(text, (c) => c.charCodeAt(0));
export const utcTime = (date) => tlv(TAG.UTC_TIME, asciiBytes(timeDigits(date, false)));
export const generalizedTime = (date) =>
  tlv(TAG.GENERALIZED_TIME, asciiBytes(timeDigits(date, true)));
/** RFC 5280 Time: UTCTime through 2049, GeneralizedTime from 2050. */
export const x509Time = (date) =>
  date.getUTCFullYear() < 2050 && date.getUTCFullYear() >= 1950
    ? utcTime(date)
    : generalizedTime(date);
/** `[n]` EXPLICIT: a constructed context tag around a complete encoding. */
export const explicit = (number, inner) => tlv(0xa0 | number, inner);
/** `[n]` IMPLICIT: the context tag replaces the inner tag. */
export const implicit = (number, content, constructed = true) =>
  tlv((constructed ? 0xa0 : 0x80) | number, content);
/** Re-tag an encoded element (for example a `[0] IMPLICIT SET` back to a SET). */
export function retag(der, tag) {
  const out = der.slice();
  out[0] = tag;
  return out;
}
export const algorithmIdentifier = (dotted, params) => sequence(oid(dotted), params);

/* ---------- Object identifiers ---------- */
export const OID = {
  // Hashes
  md5: '1.2.840.113549.2.5',
  sha1: '1.3.14.3.2.26',
  sha224: '2.16.840.1.101.3.4.2.4',
  sha256: '2.16.840.1.101.3.4.2.1',
  sha384: '2.16.840.1.101.3.4.2.2',
  sha512: '2.16.840.1.101.3.4.2.3',
  // Public keys and signatures
  rsaEncryption: '1.2.840.113549.1.1.1',
  md5WithRSA: '1.2.840.113549.1.1.4',
  sha1WithRSA: '1.2.840.113549.1.1.5',
  rsassaPss: '1.2.840.113549.1.1.10',
  mgf1: '1.2.840.113549.1.1.8',
  sha256WithRSA: '1.2.840.113549.1.1.11',
  sha384WithRSA: '1.2.840.113549.1.1.12',
  sha512WithRSA: '1.2.840.113549.1.1.13',
  sha224WithRSA: '1.2.840.113549.1.1.14',
  ecPublicKey: '1.2.840.10045.2.1',
  ecdsaWithSHA1: '1.2.840.10045.4.1',
  ecdsaWithSHA224: '1.2.840.10045.4.3.1',
  ecdsaWithSHA256: '1.2.840.10045.4.3.2',
  ecdsaWithSHA384: '1.2.840.10045.4.3.3',
  ecdsaWithSHA512: '1.2.840.10045.4.3.4',
  p256: '1.2.840.10045.3.1.7',
  p384: '1.3.132.0.34',
  p521: '1.3.132.0.35',
  ed25519: '1.3.101.112',
  // Names
  commonName: '2.5.4.3',
  surname: '2.5.4.4',
  serialNumber: '2.5.4.5',
  country: '2.5.4.6',
  locality: '2.5.4.7',
  state: '2.5.4.8',
  street: '2.5.4.9',
  organization: '2.5.4.10',
  organizationalUnit: '2.5.4.11',
  title: '2.5.4.12',
  givenName: '2.5.4.42',
  emailAddress: '1.2.840.113549.1.9.1',
  domainComponent: '0.9.2342.19200300.100.1.25',
  userId: '0.9.2342.19200300.100.1.1',
  // Extensions
  subjectKeyIdentifier: '2.5.29.14',
  keyUsage: '2.5.29.15',
  subjectAltName: '2.5.29.17',
  basicConstraints: '2.5.29.19',
  authorityKeyIdentifier: '2.5.29.35',
  extKeyUsage: '2.5.29.37',
  emailProtection: '1.3.6.1.5.5.7.3.4',
  timeStamping: '1.3.6.1.5.5.7.3.8',
  adobeAuthenticDocuments: '1.2.840.113583.1.1.5',
  // CMS
  data: '1.2.840.113549.1.7.1',
  signedData: '1.2.840.113549.1.7.2',
  encryptedData: '1.2.840.113549.1.7.6',
  contentType: '1.2.840.113549.1.9.3',
  messageDigest: '1.2.840.113549.1.9.4',
  signingTime: '1.2.840.113549.1.9.5',
  signingCertificate: '1.2.840.113549.1.9.16.2.12',
  signingCertificateV2: '1.2.840.113549.1.9.16.2.47',
  timeStampToken: '1.2.840.113549.1.9.16.2.14',
  tstInfo: '1.2.840.113549.1.9.16.1.4',
  adobeRevocation: '1.2.840.113583.1.1.8',
  // PKCS#12 and password-based encryption
  keyBag: '1.2.840.113549.1.12.10.1.1',
  pkcs8ShroudedKeyBag: '1.2.840.113549.1.12.10.1.2',
  certBag: '1.2.840.113549.1.12.10.1.3',
  x509Certificate: '1.2.840.113549.1.9.22.1',
  friendlyName: '1.2.840.113549.1.9.20',
  localKeyId: '1.2.840.113549.1.9.21',
  pbeSHA1RC4_128: '1.2.840.113549.1.12.1.1',
  pbeSHA1RC4_40: '1.2.840.113549.1.12.1.2',
  pbeSHA1TripleDES: '1.2.840.113549.1.12.1.3',
  pbeSHA1TwoKeyTripleDES: '1.2.840.113549.1.12.1.4',
  pbeSHA1RC2_128: '1.2.840.113549.1.12.1.5',
  pbeSHA1RC2_40: '1.2.840.113549.1.12.1.6',
  pbeMD5DES: '1.2.840.113549.1.5.3',
  pbeMD5RC2: '1.2.840.113549.1.5.6',
  pbeSHA1DES: '1.2.840.113549.1.5.10',
  pbeSHA1RC2: '1.2.840.113549.1.5.11',
  pbkdf2: '1.2.840.113549.1.5.12',
  pbes2: '1.2.840.113549.1.5.13',
  pbmac1: '1.2.840.113549.1.5.14',
  hmacSHA1: '1.2.840.113549.2.7',
  hmacSHA224: '1.2.840.113549.2.8',
  hmacSHA256: '1.2.840.113549.2.9',
  hmacSHA384: '1.2.840.113549.2.10',
  hmacSHA512: '1.2.840.113549.2.11',
  aes128CBC: '2.16.840.1.101.3.4.1.2',
  aes192CBC: '2.16.840.1.101.3.4.1.22',
  aes256CBC: '2.16.840.1.101.3.4.1.42',
  desCBC: '1.3.14.3.2.7',
  desEde3CBC: '1.2.840.113549.3.7',
  rc2CBC: '1.2.840.113549.3.2',
};
