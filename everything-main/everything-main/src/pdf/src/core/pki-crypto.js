/**
 * Public-key cryptography for certificates and signatures, on the Web Crypto API: digests,
 * RSA PKCS#1 v1.5, RSA-PSS and ECDSA verification and signing, and the conversions between
 * X.509/CMS encodings and what Web Crypto expects.
 */
import {
  Asn1Error,
  OID,
  algorithmIdentifier,
  concatBytes,
  decodeDer,
  integer,
  nullValue,
  sequence,
  bitString,
} from './asn1.js';
import { md5 } from './security.js';

export class CryptoUnsupportedError extends Error {
  constructor(message) {
    super(message);
    this.code = 'unsupported';
  }
}

export function subtle() {
  const api = globalThis.crypto?.subtle;
  if (!api)
    throw new Error('Digital signatures need a secure connection. Open this page over https.');
  return api;
}
export const randomBytes = (length) => globalThis.crypto.getRandomValues(new Uint8Array(length));

/* ---------- Digests ---------- */
export const HASHES = {
  [OID.md5]: { name: 'MD5', length: 16, block: 64 },
  [OID.sha1]: { name: 'SHA-1', length: 20, block: 64 },
  [OID.sha256]: { name: 'SHA-256', length: 32, block: 64 },
  [OID.sha384]: { name: 'SHA-384', length: 48, block: 128 },
  [OID.sha512]: { name: 'SHA-512', length: 64, block: 128 },
};
export const HASH_OIDS = Object.fromEntries(Object.entries(HASHES).map(([k, v]) => [v.name, k]));
export function hashByOid(dotted) {
  const hash = HASHES[dotted];
  if (!hash) throw new CryptoUnsupportedError(`Unsupported digest algorithm ${dotted}.`);
  return hash;
}
/** Digest `data` (a Uint8Array or a list of them) with a Web Crypto hash name or MD5. */
export async function digest(name, data) {
  const bytes = Array.isArray(data) ? concatBytes(data) : data;
  if (name === 'MD5') return md5(bytes);
  return new Uint8Array(await subtle().digest(name, bytes));
}

/* ---------- Signature algorithms ---------- */
const RSA_SIGNATURES = {
  [OID.md5WithRSA]: 'MD5',
  [OID.sha1WithRSA]: 'SHA-1',
  [OID.sha256WithRSA]: 'SHA-256',
  [OID.sha384WithRSA]: 'SHA-384',
  [OID.sha512WithRSA]: 'SHA-512',
};
const ECDSA_SIGNATURES = {
  [OID.ecdsaWithSHA1]: 'SHA-1',
  [OID.ecdsaWithSHA256]: 'SHA-256',
  [OID.ecdsaWithSHA384]: 'SHA-384',
  [OID.ecdsaWithSHA512]: 'SHA-512',
};
export const CURVES = {
  [OID.p256]: 'P-256',
  [OID.p384]: 'P-384',
  [OID.p521]: 'P-521',
};
const CURVE_SIZES = { 'P-256': 32, 'P-384': 48, 'P-521': 66 };

/** Parse an AlgorithmIdentifier node into `{ oid, params }` (params is an Asn1Node or null). */
export function readAlgorithm(node) {
  const kids = node.children;
  return {
    oid: kids[0].oid(),
    params: kids[1] && kids[1].tag !== 0x05 ? kids[1] : null,
  };
}

/**
 * How to verify a signature: a signature algorithm (X.509 or CMS) plus, for CMS signers that
 * name only `rsaEncryption` or `ecPublicKey`, the digest algorithm the signer used.
 */
export function signatureScheme(algorithm, digestOid) {
  const id = algorithm.oid;
  if (RSA_SIGNATURES[id]) return { kind: 'rsa', hash: RSA_SIGNATURES[id] };
  if (ECDSA_SIGNATURES[id]) return { kind: 'ecdsa', hash: ECDSA_SIGNATURES[id] };
  if (id === OID.rsaEncryption) return { kind: 'rsa', hash: hashByOid(digestOid).name };
  if (id === OID.ecPublicKey) return { kind: 'ecdsa', hash: hashByOid(digestOid).name };
  if (id === OID.rsassaPss) {
    // RSASSA-PSS-params: [0] hash (SHA-1), [1] MGF1 (SHA-1), [2] salt length (20).
    let hash = 'SHA-1';
    let mgfHash = 'SHA-1';
    let saltLength = 20;
    for (const kid of algorithm.params?.children || []) {
      if (kid.isContext(0)) hash = hashByOid(readAlgorithm(kid.child(0)).oid).name;
      else if (kid.isContext(1)) {
        const mgf = readAlgorithm(kid.child(0));
        if (mgf.params) mgfHash = hashByOid(readAlgorithm(mgf.params).oid).name;
      } else if (kid.isContext(2)) saltLength = kid.child(0).int();
    }
    if (mgfHash !== hash) throw new CryptoUnsupportedError('RSA-PSS with a different MGF hash.');
    return { kind: 'rsa-pss', hash, saltLength };
  }
  if (id === OID.ed25519) throw new CryptoUnsupportedError('Ed25519 signatures are not supported.');
  throw new CryptoUnsupportedError(`Unsupported signature algorithm ${id}.`);
}

/* ---------- Public keys ---------- */
/** Describe a SubjectPublicKeyInfo: algorithm, curve, RSA modulus and exponent. */
export function describePublicKey(spkiDer) {
  const spki = decodeDer(spkiDer);
  const algorithm = readAlgorithm(spki.child(0));
  const key = spki.child(1).bits().bytes;
  if (algorithm.oid === OID.rsaEncryption || algorithm.oid === OID.rsassaPss) {
    const rsa = decodeDer(key);
    const modulus = rsa.child(0).unsigned();
    let bits = modulus.length * 8;
    for (let top = modulus[0]; top < 0x80 && bits > 0; top <<= 1) bits--;
    return {
      type: 'RSA',
      oid: algorithm.oid,
      bits,
      modulus,
      exponent: rsa.child(1).unsigned(),
      description: `RSA ${bits}-bit`,
    };
  }
  if (algorithm.oid === OID.ecPublicKey) {
    const curveOid = algorithm.params?.tag === 0x06 ? algorithm.params.oid() : null;
    const curve = CURVES[curveOid] || null;
    return {
      type: 'EC',
      oid: algorithm.oid,
      curve,
      curveOid,
      point: key,
      description: `ECDSA ${curve || curveOid || 'explicit curve'}`,
    };
  }
  if (algorithm.oid === OID.ed25519)
    return { type: 'Ed25519', oid: algorithm.oid, description: 'Ed25519' };
  return { type: 'unknown', oid: algorithm.oid, description: algorithm.oid };
}

/** An RSA SubjectPublicKeyInfo with the plain rsaEncryption identifier Web Crypto accepts. */
function rsaSpki(info) {
  return sequence(
    algorithmIdentifier(OID.rsaEncryption, nullValue()),
    bitString(sequence(integer(info.modulus), integer(info.exponent))),
  );
}

const keyCache = new Map();
async function importVerifyKey(spkiDer, scheme) {
  const info = describePublicKey(spkiDer);
  let algorithm;
  let der = spkiDer;
  if (scheme.kind === 'ecdsa') {
    if (info.type !== 'EC') throw new Error('The certificate key does not match the signature.');
    if (!info.curve)
      throw new CryptoUnsupportedError(`Unsupported elliptic curve ${info.curveOid}.`);
    algorithm = { name: 'ECDSA', namedCurve: info.curve };
  } else {
    if (info.type !== 'RSA') throw new Error('The certificate key does not match the signature.');
    if (info.oid !== OID.rsaEncryption) der = rsaSpki(info);
    algorithm =
      scheme.kind === 'rsa-pss'
        ? { name: 'RSA-PSS', hash: scheme.hash }
        : { name: 'RSASSA-PKCS1-v1_5', hash: scheme.hash };
  }
  return {
    key: await subtle().importKey('spki', der, algorithm, false, ['verify']),
    info,
  };
}

/* ---------- ECDSA signature encodings ---------- */
/** DER `SEQUENCE { r, s }` to the fixed-width r‖s Web Crypto uses. */
export function ecdsaDerToRaw(der, size) {
  const node = decodeDer(der);
  const out = new Uint8Array(size * 2);
  [node.child(0).unsigned(), node.child(1).unsigned()].forEach((part, i) => {
    if (part.length > size) throw new Error('Malformed ECDSA signature.');
    out.set(part, i * size + size - part.length);
  });
  return out;
}
export function ecdsaRawToDer(raw) {
  const half = raw.length / 2;
  return sequence(integer(raw.subarray(0, half)), integer(raw.subarray(half)));
}

/* ---------- RSA PKCS#1 v1.5 by hand (MD5, and keys Web Crypto refuses) ---------- */
const DIGEST_INFO_PREFIX = {
  MD5: '3020300c06082a864886f70d020505000410',
  'SHA-1': '3021300906052b0e03021a05000414',
  'SHA-256': '3031300d060960864801650304020105000420',
  'SHA-384': '3041300d060960864801650304020205000430',
  'SHA-512': '3051300d060960864801650304020305000440',
};
const toBigInt = (bytes) => {
  let n = 0n;
  for (const b of bytes) n = (n << 8n) | BigInt(b);
  return n;
};
function modPow(base, exponent, modulus) {
  let result = 1n;
  base %= modulus;
  while (exponent > 0n) {
    if (exponent & 1n) result = (result * base) % modulus;
    base = (base * base) % modulus;
    exponent >>= 1n;
  }
  return result;
}
async function rsaPkcs1VerifyByHand(info, hash, data, signature) {
  const k = info.modulus.length;
  if (signature.length !== k) return false;
  const m = modPow(toBigInt(signature), toBigInt(info.exponent), toBigInt(info.modulus));
  const em = new Uint8Array(k);
  let value = m;
  for (let i = k - 1; i >= 0; i--) {
    em[i] = Number(value & 0xffn);
    value >>= 8n;
  }
  const prefix = DIGEST_INFO_PREFIX[hash];
  if (!prefix) return false;
  const h = await digest(hash, data);
  const t = concatBytes([Uint8Array.from(prefix.match(/../g), (x) => parseInt(x, 16)), h]);
  if (em[0] !== 0 || em[1] !== 1) return false;
  const padEnd = k - t.length - 1;
  if (padEnd < 10) return false;
  for (let i = 2; i < padEnd; i++) if (em[i] !== 0xff) return false;
  if (em[padEnd] !== 0) return false;
  for (let i = 0; i < t.length; i++) if (em[padEnd + 1 + i] !== t[i]) return false;
  return true;
}

/**
 * Verify `signature` over `data` with the key of a SubjectPublicKeyInfo. Resolves to a
 * boolean; throws CryptoUnsupportedError for algorithms this app cannot check.
 */
export async function verifySignature({ spki, scheme, data, signature }) {
  if (scheme.kind === 'rsa' && scheme.hash === 'MD5')
    return rsaPkcs1VerifyByHand(describePublicKey(spki), 'MD5', data, signature);
  let imported;
  try {
    const cacheKey = `${scheme.kind}:${scheme.hash}:${spki.join(',')}`;
    imported = keyCache.get(cacheKey);
    if (!imported) {
      imported = await importVerifyKey(spki, scheme);
      if (keyCache.size > 64) keyCache.clear();
      keyCache.set(cacheKey, imported);
    }
  } catch (error) {
    if (error instanceof CryptoUnsupportedError) throw error;
    if (error instanceof Asn1Error) throw error;
    // Web Crypto rejects some keys (small moduli, odd exponents); check those by hand.
    if (scheme.kind === 'rsa')
      return rsaPkcs1VerifyByHand(describePublicKey(spki), scheme.hash, data, signature);
    throw error;
  }
  const { key, info } = imported;
  if (scheme.kind === 'ecdsa') {
    let raw;
    try {
      raw = ecdsaDerToRaw(signature, CURVE_SIZES[info.curve]);
    } catch {
      return false;
    }
    return subtle().verify({ name: 'ECDSA', hash: scheme.hash }, key, raw, data);
  }
  if (scheme.kind === 'rsa-pss')
    return subtle().verify(
      { name: 'RSA-PSS', saltLength: scheme.saltLength },
      key,
      signature,
      data,
    );
  return subtle().verify({ name: 'RSASSA-PKCS1-v1_5' }, key, signature, data);
}

/* ---------- Signing ---------- */
/** The digest a private key signs with: SHA-384 for P-384, SHA-512 for P-521, else SHA-256. */
export function signingHash(privateKey) {
  if (privateKey.algorithm.name === 'ECDSA')
    return { 'P-384': 'SHA-384', 'P-521': 'SHA-512' }[privateKey.algorithm.namedCurve] || 'SHA-256';
  return privateKey.algorithm.hash?.name || 'SHA-256';
}
/** The signatureAlgorithm identifier a CMS signer or certificate uses for this key. */
export function signatureAlgorithmFor(privateKey, { cms = false } = {}) {
  const hash = signingHash(privateKey);
  if (privateKey.algorithm.name === 'ECDSA')
    return algorithmIdentifier(
      {
        'SHA-256': OID.ecdsaWithSHA256,
        'SHA-384': OID.ecdsaWithSHA384,
        'SHA-512': OID.ecdsaWithSHA512,
      }[hash],
    );
  if (privateKey.algorithm.name !== 'RSASSA-PKCS1-v1_5')
    throw new CryptoUnsupportedError(
      `Signing with ${privateKey.algorithm.name} keys is not supported.`,
    );
  if (cms) return algorithmIdentifier(OID.rsaEncryption, nullValue());
  const id = {
    'SHA-256': OID.sha256WithRSA,
    'SHA-384': OID.sha384WithRSA,
    'SHA-512': OID.sha512WithRSA,
    'SHA-1': OID.sha1WithRSA,
  }[hash];
  return algorithmIdentifier(id, nullValue());
}
/** Sign `data` with a Web Crypto private key; ECDSA signatures come back DER-encoded. */
export async function signData(privateKey, data) {
  const hash = signingHash(privateKey);
  if (privateKey.algorithm.name === 'ECDSA') {
    const raw = new Uint8Array(await subtle().sign({ name: 'ECDSA', hash }, privateKey, data));
    return ecdsaRawToDer(raw);
  }
  return new Uint8Array(await subtle().sign({ name: privateKey.algorithm.name }, privateKey, data));
}

/* ---------- Private keys ---------- */
/**
 * Import a PKCS#8 PrivateKeyInfo into Web Crypto for signing. RSA keys sign with SHA-256;
 * EC keys with the hash that matches their curve.
 */
export async function importPrivateKey(pkcs8, { extractable = true } = {}) {
  const info = decodeDer(pkcs8);
  const algorithm = readAlgorithm(info.child(1));
  if (algorithm.oid === OID.rsaEncryption)
    return subtle().importKey(
      'pkcs8',
      pkcs8,
      { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
      extractable,
      ['sign'],
    );
  if (algorithm.oid === OID.ecPublicKey) {
    let curveOid = algorithm.params?.tag === 0x06 ? algorithm.params.oid() : null;
    if (!curveOid) {
      // ECPrivateKey may name its curve in [0] parameters instead.
      const ecKey = decodeDer(info.child(2).octets());
      const params = ecKey.children.find((kid) => kid.isContext(0));
      if (params) curveOid = params.child(0).oid();
    }
    const curve = CURVES[curveOid];
    if (!curve) throw new CryptoUnsupportedError(`Unsupported elliptic curve ${curveOid}.`);
    return subtle().importKey('pkcs8', pkcs8, { name: 'ECDSA', namedCurve: curve }, extractable, [
      'sign',
    ]);
  }
  throw new CryptoUnsupportedError(`Unsupported private key type ${algorithm.oid}.`);
}
