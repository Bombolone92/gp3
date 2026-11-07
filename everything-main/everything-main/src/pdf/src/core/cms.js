/**
 * CMS SignedData (RFC 5652) as PDF signatures use it: reading signer infos, checking the
 * message digest and signature, reading RFC 3161 timestamp tokens, and producing detached
 * signatures with CAdES signed attributes.
 */
import {
  OID,
  TAG,
  algorithmIdentifier,
  bytesEqual,
  boolean,
  concatBytes,
  decodeDer,
  explicit,
  implicit,
  integer,
  octetString,
  oid,
  retag,
  sequence,
  set,
  setOf,
  utcTime,
} from './asn1.js';
import {
  CryptoUnsupportedError,
  HASH_OIDS,
  digest,
  hashByOid,
  randomBytes,
  readAlgorithm,
  signData,
  signatureAlgorithmFor,
  signatureScheme,
  signingHash,
  verifySignature,
} from './pki-crypto.js';
import { parseCertificate } from './x509.js';

export class CmsError extends Error {
  constructor(message) {
    super(message);
    this.code = 'cms';
  }
}

function readAttributes(node) {
  const map = new Map();
  for (const attr of node.children) {
    const type = attr.child(0).oid();
    map.set(type, attr.child(1).children);
  }
  return map;
}

function readSignerInfo(node) {
  const kids = node.children;
  let i = 0;
  const version = kids[i++].int();
  const sidNode = kids[i++];
  const sid = sidNode.isContext(0)
    ? { subjectKeyIdentifier: sidNode.value }
    : { issuer: sidNode.child(0).der, serial: sidNode.child(1).bigInt() };
  const digestAlgorithm = readAlgorithm(kids[i++]);
  let signedAttrs = null;
  if (kids[i]?.isContext(0)) {
    const node = kids[i++];
    // The signature covers the DER of a SET OF, not the [0] IMPLICIT tag stored here.
    signedAttrs = {
      der: retag(node.der, TAG.SET),
      attributes: readAttributes(node),
    };
  }
  const signatureAlgorithm = readAlgorithm(kids[i++]);
  const signature = kids[i++].octets();
  const unsignedAttrs = kids[i]?.isContext(1) ? readAttributes(kids[i]) : new Map();
  return {
    version,
    sid,
    digestAlgorithm,
    signedAttrs,
    signatureAlgorithm,
    signature,
    unsignedAttrs,
  };
}

/**
 * Parse a ContentInfo holding SignedData. Trailing bytes (the zero padding of a PDF
 * /Contents string) are ignored. Throws CmsError or Asn1Error on malformed input.
 */
export function parseSignedData(der) {
  const root = decodeDer(der);
  if (root.tag !== TAG.SEQUENCE) throw new CmsError('The signature is not a CMS structure.');
  const contentType = root.child(0).oid();
  if (contentType !== OID.signedData) throw new CmsError('The signature is not CMS SignedData.');
  const signedData = root.child(1).child(0);
  const kids = signedData.children;
  let i = 0;
  const version = kids[i++].int();
  const digestAlgorithms = kids[i++].children.map((n) => readAlgorithm(n).oid);
  const encap = kids[i++];
  const eContentType = encap.child(0).oid();
  const eContent = encap.children[1] ? encap.children[1].child(0).octets() : null;
  const certificates = [];
  for (; kids[i] && (kids[i].isContext(0) || kids[i].isContext(1)); i++) {
    if (!kids[i].isContext(0)) continue;
    for (const certNode of kids[i].children) {
      if (certNode.tag !== TAG.SEQUENCE) continue; // attribute or other certificate formats
      try {
        certificates.push(parseCertificate(certNode.der));
      } catch {
        // Skip a certificate this parser cannot read; the signer may still be found.
      }
    }
  }
  const signerInfos = (kids[i]?.children || []).map(readSignerInfo);
  if (!signerInfos.length) throw new CmsError('The signature has no signer.');
  return {
    der: root.der,
    version,
    digestAlgorithms,
    eContentType,
    eContent,
    certificates,
    signerInfos,
  };
}

export function findSignerCertificate(cms, signer) {
  return (
    cms.certificates.find((cert) =>
      signer.sid.subjectKeyIdentifier
        ? bytesEqual(cert.extensions.subjectKeyIdentifier, signer.sid.subjectKeyIdentifier)
        : bytesEqual(cert.issuer.der, signer.sid.issuer) && cert.serial === signer.sid.serial,
    ) || null
  );
}

const firstValue = (attrs, id) => attrs?.get(id)?.[0] || null;

/** The signingTime signed attribute, if present and readable. */
export function signedSigningTime(signer) {
  try {
    return firstValue(signer.signedAttrs?.attributes, OID.signingTime)?.time() || null;
  } catch {
    return null;
  }
}

/**
 * Check one signer of `cms` against `content` (the signed bytes, or a list of byte ranges).
 * Never throws: problems are reported in the result.
 */
export async function verifySigner(cms, signer, content) {
  const result = {
    certificate: findSignerCertificate(cms, signer),
    digestAlgorithm: digestName(signer.digestAlgorithm.oid),
    signatureAlgorithm: signer.signatureAlgorithm.oid,
    digestMatches: false,
    signatureValid: false,
    signingTime: signedSigningTime(signer),
    unsupported: null,
    error: null,
  };
  try {
    const hash = hashByOid(signer.digestAlgorithm.oid);
    const computed = await digest(hash.name, content);
    result.digest = computed;
    let signedBytes;
    if (signer.signedAttrs) {
      const attrs = signer.signedAttrs.attributes;
      const messageDigest = firstValue(attrs, OID.messageDigest);
      if (!messageDigest) throw new CmsError('The signature has no message digest attribute.');
      result.digestMatches = bytesEqual(messageDigest.octets(), computed);
      const type = firstValue(attrs, OID.contentType);
      if (type && type.oid() !== cms.eContentType)
        throw new CmsError('The content type attribute does not match the signed content.');
      signedBytes = signer.signedAttrs.der;
    } else {
      // Without signed attributes the signature covers the content itself.
      result.digestMatches = true;
      signedBytes = content;
    }
    if (!result.certificate)
      throw new CmsError("The signer's certificate is not in the signature.");
    const scheme = signatureScheme(signer.signatureAlgorithm, signer.digestAlgorithm.oid);
    result.scheme = scheme;
    const data = Array.isArray(signedBytes) ? concatBytes(signedBytes) : signedBytes;
    result.signatureValid = await verifySignature({
      spki: result.certificate.spki,
      scheme,
      data,
      signature: signer.signature,
    });
  } catch (error) {
    if (error instanceof CryptoUnsupportedError) result.unsupported = error.message;
    else result.error = error.message || String(error);
  }
  return result;
}

function digestName(dotted) {
  try {
    return hashByOid(dotted).name;
  } catch {
    return dotted;
  }
}

/* ---------- Timestamps ---------- */
function readTstInfo(bytes) {
  const node = decodeDer(bytes);
  const kids = node.children;
  const imprint = kids[2];
  const info = {
    policy: kids[1].oid(),
    hashAlgorithm: readAlgorithm(imprint.child(0)).oid,
    hashedMessage: imprint.child(1).octets(),
    serial: kids[3].bigInt(),
    genTime: kids[4].time(),
    tsa: '',
  };
  const tsa = kids.find((kid) => kid.isContext(0));
  if (tsa) {
    const name = tsa.child(0);
    info.tsa = name.isContext(4) ? describeName(name.child(0)) : '';
  }
  return info;
}
function describeName(node) {
  try {
    const parts = [];
    for (const rdn of node.children)
      for (const atv of rdn.children)
        if (atv.child(0).oid() === OID.commonName) parts.push(atv.child(1).string());
    return parts.join(', ');
  } catch {
    return '';
  }
}

/**
 * Check an RFC 3161 timestamp token over `data`: its message imprint and the TSA's signature.
 * Never throws.
 */
export async function verifyTimestampToken(tokenDer, data) {
  const result = {
    time: null,
    imprintMatches: false,
    signatureValid: false,
    tsa: '',
    certificate: null,
    error: null,
  };
  try {
    const cms = parseSignedData(tokenDer);
    if (cms.eContentType !== OID.tstInfo || !cms.eContent)
      throw new CmsError('Not a timestamp token.');
    const info = readTstInfo(cms.eContent);
    result.time = info.genTime;
    result.serial = info.serial;
    result.policy = info.policy;
    const hash = hashByOid(info.hashAlgorithm);
    result.imprintMatches = bytesEqual(await digest(hash.name, data), info.hashedMessage);
    const check = await verifySigner(cms, cms.signerInfos[0], cms.eContent);
    result.signatureValid = check.digestMatches && check.signatureValid;
    result.certificate = check.certificate;
    result.tsa = check.certificate?.subject.commonName || info.tsa;
    result.certificates = cms.certificates;
    if (check.error || check.unsupported) result.error = check.error || check.unsupported;
  } catch (error) {
    result.error = error.message || String(error);
  }
  return result;
}

/* ---------- Signing ---------- */
/**
 * A detached CMS SignedData over content whose digest is `contentDigest`.
 *
 * `cades` (PAdES, SubFilter ETSI.CAdES.detached) adds signingCertificateV2 and leaves out the
 * signingTime attribute, which PAdES forbids (the time goes in the PDF's /M instead); the
 * adbe.pkcs7.detached form keeps signingTime and adds signingCertificateV2 as well.
 */
export async function createSignedData({
  privateKey,
  certificate,
  chain = [],
  contentDigest,
  signingTime = new Date(),
  cades = true,
  timestamp = null,
}) {
  const hashName = signingHash(privateKey);
  const hashOid = HASH_OIDS[hashName];
  const cert = parseCertificate(certificate);
  const attribute = (id, value) => sequence(oid(id), set(value));
  const certHash = await digest(hashName, cert.der);
  const essCertId = sequence(
    hashName === 'SHA-256' ? null : algorithmIdentifier(hashOid),
    octetString(certHash),
    sequence(sequence(explicit(4, cert.issuer.der)), cert.serialDer),
  );
  const attributes = [
    attribute(OID.contentType, oid(OID.data)),
    cades ? null : attribute(OID.signingTime, utcTime(signingTime)),
    attribute(OID.messageDigest, octetString(contentDigest)),
    attribute(OID.signingCertificateV2, sequence(sequence(essCertId))),
  ];
  const signedAttrs = setOf(attributes);
  const signature = await signData(privateKey, signedAttrs);
  // An RFC 3161 timestamp over the signature value, as an unsigned attribute.
  let unsigned = null;
  if (timestamp) {
    const token = await requestTimestamp(timestamp, signature, hashName);
    unsigned = implicit(1, attribute(OID.timeStampToken, token));
  }
  const signerInfo = sequence(
    integer(1),
    sequence(cert.issuer.der, cert.serialDer),
    algorithmIdentifier(hashOid),
    retag(signedAttrs, 0xa0),
    signatureAlgorithmFor(privateKey, { cms: true }),
    octetString(signature),
    unsigned,
  );
  const certificates = [cert.der, ...chain.filter((c) => !bytesEqual(c, cert.der))];
  const signedData = sequence(
    integer(1),
    set(algorithmIdentifier(hashOid)),
    sequence(oid(OID.data)),
    implicit(0, concatBytes(certificates)),
    set(signerInfo),
  );
  return sequence(oid(OID.signedData), explicit(0, signedData));
}

/* ---------- Timestamp requests (RFC 3161) ---------- */
/** A TimeStampReq for `data`, to POST to a TSA as application/timestamp-query. */
export async function createTimestampRequest(data, hash = 'SHA-256') {
  const imprint = await digest(hash, data);
  const nonce = randomBytes(8);
  nonce[0] &= 0x7f;
  const request = sequence(
    integer(1),
    sequence(algorithmIdentifier(HASH_OIDS[hash]), octetString(imprint)),
    integer(nonce),
    boolean(true),
  );
  return { request, imprint, nonce };
}

/** The timestamp token of a TimeStampResp, after checking its status and imprint. */
export function readTimestampResponse(der, expectedImprint) {
  const response = decodeDer(der);
  const status = response.child(0).child(0).int();
  if (status !== 0 && status !== 1) {
    const text = response
      .child(0)
      .children[1]?.children.map((n) => n.string())
      .join(' ');
    throw new CmsError(`The timestamp server refused the request${text ? `: ${text}` : '.'}`);
  }
  const token = response.children[1];
  if (!token) throw new CmsError('The timestamp server sent no timestamp.');
  if (expectedImprint) {
    const cms = parseSignedData(token.der);
    const imprint = decodeDer(cms.eContent).child(2).child(1).octets();
    if (!bytesEqual(imprint, expectedImprint))
      throw new CmsError('The timestamp is for different data.');
  }
  return token.der.slice();
}

/**
 * Get a timestamp token over `data` through `send`, a function that delivers a
 * TimeStampReq to a TSA and resolves to its TimeStampResp (for example with fetch).
 */
export async function requestTimestamp(send, data, hash = 'SHA-256') {
  const { request, imprint } = await createTimestampRequest(data, hash);
  const response = await send(request);
  return readTimestampResponse(
    response instanceof Uint8Array ? response : new Uint8Array(response),
    imprint,
  );
}
