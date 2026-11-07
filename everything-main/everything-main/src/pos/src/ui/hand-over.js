/**
 * "Can I get a receipt?" - the one action, shared by the sale-complete screen
 * and the receipt history, so both behave identically.
 */

import { toast } from './toast.js';
import { store } from '../lib/store.js';
import { shareReceipt } from './receipt-image.js';

/**
 * handOverReceipt(receipt, button?)
 *
 * Disables the button while the image renders (a receipt takes a moment on a
 * slow tablet) and reports what actually happened.
 */
export async function handOverReceipt(receipt, button = null) {
  if (button) button.disabled = true;
  try {
    const how = await shareReceipt(receipt, store);
    if (how === 'downloaded') toast('Receipt saved as an image', { icon: 'fileDown' });
    else if (how === 'shared') toast('Receipt shared', { icon: 'share' });
  } catch (err) {
    console.error(err);
    toast('Couldn’t make a copy of the receipt', { icon: 'alert' });
  } finally {
    if (button) button.disabled = false;
  }
}
