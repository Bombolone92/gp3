export const section = (id, title, html) => ({ id, title, html });
export const figure = (file, width, height, alt, caption) => `<figure class="site-figure"><img src="/screenshots/${file}" width="${width}" height="${height}" loading="lazy" decoding="async" alt="${alt}" /><figcaption>${caption}</figcaption></figure>`;

// Cells are trusted editorial HTML, like article sections.
export const table = (caption, headings, rows) => `<div class="site-table" tabindex="0" role="region" aria-label="${caption}"><table><caption>${caption}</caption><thead><tr>${headings.map(h => `<th scope="col">${h}</th>`).join('')}</tr></thead><tbody>${rows.map(row => `<tr>${row.map((cell, i) => i ? `<td>${cell}</td>` : `<th scope="row">${cell}</th>`).join('')}</tr>`).join('')}</tbody></table></div>`;
