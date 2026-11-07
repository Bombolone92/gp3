# Landing page SEO audit

Audited September 10, 2026, against `https://cap-table.io/` and the local production build. The live site included the preceding design and social-image updates. Scope covers the homepage, its linked content, sitemap destinations, URL handling, structured data, and one mobile Lighthouse run. Search Console, keyword volumes, backlinks, and real-user Core Web Vitals were not available.

## Assessment

The homepage has sound technical SEO and no crawl blocker was found. The most useful next steps are improving mobile loading, making the existing content easier to discover, and checking actual indexing and query performance in Search Console. The automated SEO score is a technical checklist result, not a ranking prediction.

## What passed on the live site

| Check | Evidence |
| --- | --- |
| Availability | Homepage returns HTTPS `200` with valid TLS. HTTP redirects to HTTPS with `301`. |
| Public content | Headings, feature copy, FAQ answers, links, and JSON-LD are present in the initial HTML without sign-in or JavaScript rendering. |
| Indexing directives | `index, follow, max-image-preview:large`; no conflicting `X-Robots-Tag` observed. `robots.txt` permits crawling and references the sitemap. |
| Canonical | Exactly one absolute canonical points to `https://cap-table.io/`. |
| Title and description | Descriptive, relevant title (57 characters) and description (151 characters), with the primary product category and free offering. These lengths are observations, not fixed Google limits. |
| Headings and content | One H1; a clear commercial product page with features, a real screenshot labeled as sample data, setup information, and FAQs. The existing title and description do not need arbitrary keyword additions. |
| Sitemap | All 69 listed URLs returned `200`, had unique titles, one H1, matching self-canonicals, and no HTML `noindex`. |
| Images | Product screenshot has descriptive alt text and dimensions. The mobile picture source and high-priority hero image are present. Decorative icons correctly use empty alt text. |
| Social sharing | The 1200 × 630 JPEG responds with `200` and `image/jpeg`; Open Graph and X large-image metadata are present. Social previews are not a direct ranking guarantee. |
| Structured data | `SoftwareApplication` and `WebSite` JSON-LD parse correctly and describe the visible product, publisher, and zero-price offer. |
| Missing URLs | Unknown root and documentation paths return a real `404`, rather than `200`. The body issue below is separate from their correct status. |

## Findings, priorities, and action

| Priority | Finding | Action/status |
| --- | --- | --- |
| Medium | Mobile lab LCP was 3.0s. The homepage downloads application code that is largely unused by signed-out visitors. | Plan a focused performance change: split signed-in workspace code from the public entry and inspect SDK loading before changing session behavior. Lighthouse estimates about 224 KiB of unused JavaScript across the app bundle and SDK. Estimated savings are diagnostic, not measured improvements. |
| Medium | The homepage linked to `/docs/` and `/guides/`, but no individual articles. | **Implemented locally:** five contextual links to ownership definitions, vesting, round modeling, CSV import, and the cap-table introduction. The links reuse existing prose, have descriptive anchor text, and are visibly underlined. |
| Low | The block-level span in the H1 had no whitespace separating its text in the HTML. | **Implemented locally:** inserted whitespace so plain-text extraction reads the two sentences separately. No visual redesign or claimed ranking penalty. |
| Low | `/index.html` and sampled documentation `index.html` variants return `200` instead of redirecting to their directory URLs. Their canonical tags are correct. | Optional hosting cleanup: permanently redirect explicit `index.html` variants to the corresponding canonical directory URL, preserving the query string. Existing canonical tags already provide a valid consolidation signal. |
| Low | `www.cap-table.io` does not resolve. | If the brand should accept this variant, configure DNS, TLS, and a permanent redirect to the non-www origin. This is not a blocker for the working canonical host. |
| Low | Missing URLs return the homepage HTML with status `404`, although a purpose-built `404.html` exists. | Configure the hosting error response to serve `404.html` while preserving HTTP `404`. This improves recovery UX; the current error status already prevents these URLs from behaving like successful pages. |
| Operational | HTML responses include `s-maxage=31536000`, allowing a year of shared-cache freshness. | Confirm deployment invalidates changed HTML, sitemap, and robots responses. The sampled homepage was current; stale delivery was not observed. |
| Data-dependent | Software rich-result requirements include a genuine rating or review, which the current markup does not contain. | Keep the accurate general schema. Add review/rating markup only if real, eligible, visible review data becomes available. This is a rich-result eligibility limit, not a general indexing error. |

Hosting changes were not applied: this repository contains no deployment, DNS, or CDN configuration for these settings.

## Mobile Lighthouse baseline

Lighthouse 13.4.1, live homepage, September 10 at 15:30 UTC, default simulated mobile conditions, native ARM64 Node and Chromium. One successful run, no run warnings. These are lab results from the live version before the local link edits, not field measurements or an INP assessment.

| Metric | Result |
| --- | --- |
| Technical SEO checklist | 100/100 |
| Performance | 93/100 |
| First Contentful Paint | 1.8s |
| Largest Contentful Paint | 3.0s |
| Total Blocking Time | 30ms |
| Cumulative Layout Shift | 0 |

Google recommends good real-world LCP, INP, and CLS. The 3.0s lab LCP suggests an optimization opportunity relative to the [2.5s LCP target](https://developers.google.com/search/docs/appearance/core-web-vitals), but does not establish a field failure. The report also estimated approximately 45 KiB of image savings, mostly from the 192px app icon; prioritize the larger JavaScript opportunity before changing the product screenshot.

## Content and search follow-up

1. In Search Console, inspect the homepage's index status, Google-selected canonical, rendered HTML, sitemap discovery, and mobile Core Web Vitals. A successful HTTP check does not prove Google has indexed a URL.
2. Use query impressions, clicks, click-through rate, and position to evaluate the existing focus on free cap table software for startups. Treat ownership, vesting, fundraising, and CSV import as supporting topics; avoid competing with the detailed guides for every term on the homepage.
3. Add genuine product evidence over time: useful worked examples, verified customer feedback where available, and clear editorial review/source attribution for specialized equity articles. Do not invent reviews, credentials, usage counts, or claims to fill schema fields.
4. Keep FAQ answers useful to readers. Google [retired FAQ rich results in May 2026](https://developers.google.com/search/updates); adding FAQ markup is not a current Google rich-result opportunity.

## Local validation

- Production build and all 15 relevant landing/public-content tests passed.
- All homepage internal URLs and anchors resolve against the generated page registry; the five new article destinations also returned `200` in the live sitemap check.
- The built homepage retains one H1, one title, one meta description, one canonical, valid JSON-LD, and available local image files.
- The new links were checked in desktop/mobile light and mobile dark views for visual affordance, overflow, and automated accessibility regressions.

## References

- [Google: crawlable links and contextual internal linking](https://developers.google.com/search/docs/crawling-indexing/links-crawlable)
- [Google: canonical URLs and duplicate consolidation](https://developers.google.com/search/docs/crawling-indexing/consolidate-duplicate-urls)
- [Google: title links](https://developers.google.com/search/docs/appearance/title-link) and [meta descriptions](https://developers.google.com/search/docs/appearance/snippet)
- [Google: software application structured data requirements](https://developers.google.com/search/docs/appearance/structured-data/software-app)
- [Google: Core Web Vitals and Search](https://developers.google.com/search/docs/appearance/core-web-vitals)
- [Google: documentation updates, including FAQ retirement](https://developers.google.com/search/updates)
- [Google: HTTP status codes and crawling](https://developers.google.com/crawling/docs/troubleshooting/http-status-codes)
