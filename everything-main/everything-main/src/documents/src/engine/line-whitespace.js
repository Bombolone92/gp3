// Blank-line characters are a narrower set than Unicode White_Space and
// include zero-width space. NBSP, thin/figure/hair spaces and word joiner
// retain text metrics. Native controls: inline-picture-whitespace.
export const hasLineText = text => /[^ \t\u2002\u2003\u2005\u200b\u3000\ufeff]/u.test(text);
