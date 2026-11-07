// Email domains an organization claims, checked the same way by the admin
// console and the worker.

// Labels of 1 to 63 letters, digits, or inner hyphens; a top-level domain
// of letters, or an internationalized one in punycode (xn--p1ai).
export const DOMAIN =
  /^(?=.{1,253}$)((?!-)[a-z0-9-]{1,63}(?<!-)\.)+([a-z]{2,63}|xn--[a-z0-9-]{1,59})$/;
// Addresses anyone can sign up for: claiming one would make every person
// with a free mailbox there a member.
export const PUBLIC_EMAIL_DOMAINS = new Set([
  "gmail.com",
  "googlemail.com",
  "outlook.com",
  "hotmail.com",
  "hotmail.ca",
  "live.com",
  "live.ca",
  "msn.com",
  "yahoo.com",
  "yahoo.ca",
  "ymail.com",
  "aol.com",
  "icloud.com",
  "me.com",
  "mac.com",
  "proton.me",
  "protonmail.com",
  "pm.me",
  "gmx.com",
  "gmx.net",
  "mail.com",
  "zoho.com",
  "yandex.com",
  "yandex.ru",
  "qq.com",
  "163.com",
  "126.com",
  "puter.com",
  "hotmail.co.uk",
  "hotmail.fr",
  "live.co.uk",
  "live.fr",
  "outlook.fr",
  "yahoo.co.uk",
  "yahoo.fr",
  "orange.fr",
  "free.fr",
  "laposte.net",
  "web.de",
  "gmx.de",
  "sympatico.ca",
  "videotron.ca",
  "bell.net",
  "rogers.com",
  "shaw.ca",
  "telus.net",
]);
// Domains under which anyone can register their own, such as co.uk or
// github.io: as subdomains count as the organization's, claiming one would
// claim every organization under it.
const OPEN_SUFFIXES = new Set([
  "github.io",
  "gitlab.io",
  "herokuapp.com",
  "vercel.app",
  "netlify.app",
  "pages.dev",
  "workers.dev",
  "web.app",
  "firebaseapp.com",
  "appspot.com",
  "blogspot.com",
  "azurewebsites.net",
  "cloudfront.net",
  "amazonaws.com",
  "puter.site",
  "puter.work",
]);
// Second-level domains that countries open to anyone, as co.uk, com.au,
// or org.nz.
const COUNTRY_SECOND_LEVEL =
  /^(co|com|net|org|gov|edu|ac|or|ne|go|gob|nom)\.[a-z]{2}$/;
const openSuffix = (domain) =>
  OPEN_SUFFIXES.has(domain) || COUNTRY_SECOND_LEVEL.test(domain);
// A domain as written (münchen.de, @Example.ca) in the form stored and
// matched (xn--mnchen-3ya.de, example.ca). Text that is not a host name is
// returned lowercased, for the check to refuse.
export function asciiDomain(value) {
  const text = String(value || "")
    .trim()
    .replace(/^@/, "")
    .toLowerCase();
  if (!text || /[\s/?#:@\\[\]]/.test(text)) return text;
  try {
    return new URL(`http://${text}`).hostname;
  } catch {
    return text;
  }
}
// The first entry that cannot be claimed, and why, or null.
export function domainProblem(domains, kept = []) {
  for (const domain of domains) {
    if (!DOMAIN.test(domain)) return { domain, reason: "invalid" };
    if (kept.includes(domain)) continue;
    if (PUBLIC_EMAIL_DOMAINS.has(domain)) return { domain, reason: "public" };
    if (openSuffix(domain)) return { domain, reason: "suffix" };
  }
  return null;
}
