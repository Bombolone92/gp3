// Country list + name/code helpers. Names are resolved via Intl.DisplayNames
// (available in browsers and Node), so we only hard-code ISO 3166-1 alpha-2
// codes and stay localization-friendly.

const CODES =
  ('AF AL DZ AD AO AG AR AM AW AU AT AZ BS BH BD BB BY BE BZ BJ BM BT BO BA BW BR BN BG BF BI KH CM CA CV KY CF TD CL CN CO KM CG CD CR CI HR CU CY CZ DK DJ DM DO EC EG SV GQ ER EE SZ ET FJ FI FR GF PF GA GM GE DE GH GI GR GL GD GP GU GT GN GW GY HT HN HK HU IS IN ID IR IQ IE IL IT JM JP JO KZ KE KI KW KG LA LV LB LS LR LY LI LT LU MO MG MW MY MV ML MT MH MQ MR MU MX FM MD MC MN ME MA MZ MM NA NR NP NL NC NZ NI NE NG NO OM PK PW PS PA PG PY PE PH PL PT PR QA RO RU RW KN LC VC WS SM ST SA SN RS SC SL SG SK SI SB SO ZA SS ES LK SD SR SE CH SY TW TJ TZ TH TG TO TT TN TR TM UG UA AE GB US UY UZ VU VA VE VN YE ZM ZW').split(' ')

let _dn
function displayNames() {
  if (_dn === undefined) {
    try {
      _dn = new Intl.DisplayNames(['en'], { type: 'region' })
    } catch (_e) {
      _dn = null
    }
  }
  return _dn
}

/** Localized country name for an ISO code, falling back to the code. */
export function countryName(code) {
  if (!code) return ''
  const d = displayNames()
  if (!d) return code
  try {
    return d.of(code) || code
  } catch (_e) {
    return code
  }
}

/** Country options ({ code, name }) sorted by name, for a <select>. */
export const COUNTRY_OPTIONS = CODES.map((code) => ({ code, name: countryName(code) }))
  .filter((o) => o.name && o.name !== o.code)
  .sort((a, b) => a.name.localeCompare(b.name))

let _reverse
/** Best-effort ISO code for a country name (used when importing vCards). */
export function countryCodeFromName(name) {
  if (!name) return ''
  if (!_reverse) {
    _reverse = new Map()
    for (const o of COUNTRY_OPTIONS) _reverse.set(o.name.toLowerCase(), o.code)
  }
  return _reverse.get(String(name).trim().toLowerCase()) || ''
}

/** A sensible default country derived from the browser locale. */
export function defaultCountryCode() {
  try {
    const region = (navigator.language || '').split('-')[1]
    if (region && CODES.includes(region.toUpperCase())) return region.toUpperCase()
  } catch (_e) {
    /* no navigator (e.g. tests) */
  }
  return 'US'
}
