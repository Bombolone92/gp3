/**
 * Finding a menu item by name, wherever the menu keeps it.
 *
 * Menus group their longer lists into submenus, so an item a test names may
 * sit one level in. These open each submenu on the way and look again, so a
 * test says which item it means and leaves the arrangement to the menu.
 */

const labels = (item) => {
  const label = item.querySelector('.menu-label');
  return [label?.firstChild?.textContent, label?.textContent, item.textContent].map((t) => t?.trim());
};

const openItems = () => [...document.querySelectorAll('.menu .menu-item')];

/** The item with this label among the menus on screen, or null. */
export function findMenuItem(label) {
  return openItems().find((item) => labels(item).includes(label)) || null;
}

/**
 * The item with this label, opening submenus until it turns up. Submenus
 * built from a document read are not opened here; a test that wants one waits
 * for it as it would for any other read.
 */
export function menuItem(label) {
  const found = findMenuItem(label);
  if (found) return found;
  for (const parent of openItems()) {
    if (!parent.isConnected || parent.disabled || parent.getAttribute('aria-haspopup') !== 'menu') continue;
    parent.click();
    const hit = findMenuItem(label);
    if (hit) return hit;
  }
  throw new Error(`No menu item labelled "${label}". On screen: ${openItems().map((item) => labels(item)[0]).join(', ')}`);
}

/** Open the submenus needed to reach this item, then click it. */
export function chooseMenuItem(label) {
  const item = menuItem(label);
  item.click();
  return item;
}

/** The open menu with this name, or null. A submenu leaves its parent open. */
export function openMenuNamed(label) {
  return [...document.querySelectorAll('.menu[role="menu"]')].find((menu) => menu.getAttribute('aria-label') === label) || null;
}

/** The innermost menu on screen: the last one a submenu opened. */
export function innerMenu() {
  return [...document.querySelectorAll('.menu[role="menu"]')].at(-1) || null;
}
