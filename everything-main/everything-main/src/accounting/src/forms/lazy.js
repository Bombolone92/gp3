/**
 * Async entry points to the forms, for code on the first screen. The forms
 * (and the pickers, grids and dialogs behind them) download on first use.
 */
const forms = () => import('./index.js');

export const openNew = (...args) => forms().then((m) => m.openNew(...args));
export const openTxn = (...args) => forms().then((m) => m.openTxn(...args));
export const openTxnForm = (...args) => forms().then((m) => m.openTxnForm(...args));
export const openContactForm = (...args) => import('./contact.js').then((m) => m.openContactForm(...args));
export const openItemForm = (...args) => import('./item.js').then((m) => m.openItemForm(...args));
export const openAccountForm = (...args) => import('./account.js').then((m) => m.openAccountForm(...args));
