/**
 * Open safety recalls from NHTSA's public recalls API (US market), looked
 * up by model year, make, and model.
 */
const ENDPOINT = 'https://api.nhtsa.gov/recalls/recallsByVehicle';

export function parseRecalls(data) {
  return (data?.results || [])
    .map((r) => ({
      campaign: String(r.NHTSACampaignNumber || ''),
      date: parseDate(r.ReportReceivedDate),
      component: r.Component || '',
      summary: r.Summary || '',
      consequence: r.Consequence || '',
      remedy: r.Remedy || '',
      parkIt: Boolean(r.parkIt),
    }))
    .filter((r) => r.campaign)
    .sort((a, b) => String(b.date).localeCompare(String(a.date)));
}

/** "21/02/2019" (day/month/year, as the API sends it) or ISO -> "2019-02-21" */
function parseDate(s) {
  const t = String(s || '');
  const m = /^(\d{2})\/(\d{2})\/(\d{4})/.exec(t);
  if (m) return `${m[3]}-${m[2]}-${m[1]}`;
  return /^\d{4}-\d{2}-\d{2}/.test(t) ? t.slice(0, 10) : null;
}

async function lookup(year, make, model, fetchFn) {
  const q = new URLSearchParams({ make, model, modelYear: String(year) });
  let res;
  try {
    res = await fetchFn(`${ENDPOINT}?${q}`);
  } catch {
    throw new Error('The recall service could not be reached. Check your connection.');
  }
  if (!res.ok) throw new Error('The recall service did not answer. Try again later.');
  let data = null;
  try {
    data = await res.json();
  } catch {
    // An error page from a proxy or an outage, not recall data.
  }
  if (!Array.isArray(data?.results)) throw new Error('The recall service sent an answer the app could not read. Try again later.');
  return parseRecalls(data);
}

/**
 * NHTSA matches the model name exactly, and lists some models without the
 * size or trim people add ("TRANSIT" for "Transit 250") while others keep
 * it ("SILVERADO 1500"). When the full name finds nothing, try again
 * without its last word.
 */
export async function fetchRecalls({ year, make, model }, fetchFn = globalThis.fetch) {
  if (!year || !make || !model) throw new Error('Add the year, make, and model to check for recalls.');
  const name = String(model).trim();
  const list = await lookup(year, make, name, fetchFn);
  const shorter = name.replace(/\s+\S+$/, '');
  if (list.length || shorter === name) return list;
  return lookup(year, make, shorter, fetchFn);
}
