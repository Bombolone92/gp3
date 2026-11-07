/**
 * Text direction. A cell's text is laid out right to left when its first letter is in a
 * right-to-left script (leading digits, punctuation and spaces do not decide it): the box takes that direction and, given no alignment, the text
 * sits at its end, the right. The grid and the print table share this rule.
 */
export const RTL_LEAD = /^[^\p{L}]*[\p{Script=Hebrew}\p{Script=Arabic}\p{Script=Syriac}\p{Script=Thaana}\p{Script=Nko}\p{Script=Samaritan}\p{Script=Mandaic}\p{Script=Adlam}]/u;

/** Whether text reads right to left: its first letter is in a right-to-left script. */
export const readsRightToLeft = (text) => typeof text === 'string' && RTL_LEAD.test(text);
