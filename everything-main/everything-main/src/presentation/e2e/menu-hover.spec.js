import { test, expect } from "@playwright/test";

async function menuFixture(page) {
  await page.route("**/menu-hover-test.html", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: '<!doctype html><link rel="stylesheet" href="/src/style.css"><button id="opener" style="position:absolute;left:24px;top:24px">Open menu</button><output id="result"></output>',
    }),
  );
  await page.goto("/menu-hover-test.html");
  await page.evaluate(async () => {
    window.menuUi = await import("/src/ui.js");
    window.menuItems = [
      { label: "First action" },
      {
        label: "More choices",
        items: [
          {
            label: "Child action",
            onSelect: () => {
              document.querySelector("#result").textContent = "Chosen";
            },
          },
        ],
      },
      { label: "Last action" },
    ];
    window.showMenu = () =>
      menuUi.openMenu({
        anchor: document.querySelector("#opener"),
        label: "Test menu",
        items: menuItems,
      });
    document.querySelector("#opener").onclick = showMenu;
  });
  await page.getByRole("button", { name: "Open menu" }).click();
  await expect(
    page.getByRole("menuitem", { name: "First action", exact: true }),
  ).toBeFocused();
}
const branch = (page) =>
  page.getByRole("menuitem", { name: "More choices", exact: true });
const child = (page) =>
  page.getByRole("menuitem", { name: "Child action", exact: true });
// A reading pause should leave the user's choice and keyboard focus alone.
const pause = (page) => page.waitForTimeout(400);

test("a menu appearing under a stationary mouse does not change keyboard focus or open a submenu", async ({
  page,
}) => {
  await menuFixture(page);
  const box = await branch(page).boundingBox();
  await page.keyboard.press("Escape");
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.getByRole("button", { name: "Open menu" }).focus();
  await page.keyboard.press("Enter");
  await expect(branch(page)).toBeVisible();
  await pause(page);
  await expect(child(page)).toHaveCount(0);
  await expect(
    page.getByRole("menuitem", { name: "First action", exact: true }),
  ).toBeFocused();
  // Movement within the newly appeared item is enough to resume mouse input.
  await page.mouse.move(box.x + box.width / 2 + 3, box.y + box.height / 2);
  await expect(child(page)).toBeVisible();
  await expect(branch(page)).toBeFocused();
});

test("scrolling a menu underneath a stationary pointer does not activate a new item", async ({
  page,
}) => {
  await menuFixture(page);
  await page.evaluate(() => {
    menuUi.closeMenu();
    const more = menuItems[1];
    window.menuItems = Array.from({ length: 60 }, (_, i) =>
      i === 10 ? more : { label: `Action ${i}` },
    );
    showMenu();
  });
  const first = page.getByRole("menuitem", { name: "Action 0", exact: true });
  await first.hover();
  const box = await first.boundingBox();
  await page.evaluate(() => {
    const panel = document.querySelector('[role="menu"]');
    const items = panel.querySelectorAll('[role="menuitem"]');
    panel.scrollTop +=
      items[10].getBoundingClientRect().top -
      items[0].getBoundingClientRect().top;
  });
  expect(
    await page.evaluate(
      ({ x, y }) =>
        document.elementFromPoint(x, y)?.closest('[role="menuitem"]')
          ?.textContent,
      { x: box.x + box.width / 2, y: box.y + box.height / 2 },
    ),
  ).toContain("More choices");
  await pause(page);
  await expect(child(page)).toHaveCount(0);
  await expect(first).toBeFocused();
});

for (const interrupt of ["keyboard", "leave", "press"]) {
  test(`${interrupt} input cancels a pending submenu hover`, async ({
    page,
  }) => {
    await menuFixture(page);
    // Deliver adjacent input events in one browser task so the hover delay
    // cannot expire between the two inputs on a busy test machine.
    await branch(page).evaluate((node, interrupt) => {
      node.dispatchEvent(
        new PointerEvent("pointerenter", { pointerType: "mouse" }),
      );
      node.dispatchEvent(
        new PointerEvent("pointermove", {
          pointerType: "mouse",
          bubbles: true,
        }),
      );
      if (interrupt === "keyboard")
        node.dispatchEvent(
          new KeyboardEvent("keydown", {
            key: "ArrowDown",
            bubbles: true,
            cancelable: true,
          }),
        );
      else if (interrupt === "leave")
        node.dispatchEvent(
          new PointerEvent("pointerleave", { pointerType: "mouse" }),
        );
      else {
        const first = node.parentElement.querySelector('[role="menuitem"]');
        first.dispatchEvent(
          new PointerEvent("pointerdown", {
            pointerType: "touch",
            bubbles: true,
          }),
        );
        first.focus();
      }
    }, interrupt);
    await pause(page);
    await expect(child(page)).toHaveCount(0);
    if (interrupt === "keyboard")
      await expect(
        page.getByRole("menuitem", { name: "Last action", exact: true }),
      ).toBeFocused();
  });
}

test("mouse movement opens a submenu without restarting its delay on every move", async ({
  page,
}) => {
  await menuFixture(page);
  const box = await branch(page).boundingBox();
  await page.mouse.move(box.x + 12, box.y + box.height / 2);
  for (let i = 0; i < 8; i++) {
    await page.mouse.move(box.x + 13 + i, box.y + box.height / 2);
    await page.waitForTimeout(25);
  }
  // Check immediately: a timer restarted by every move would still be pending.
  expect(await child(page).count()).toBe(1);
  await expect(branch(page)).toBeFocused();
  await page.keyboard.press("ArrowRight");
  await expect(child(page)).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(child(page)).toHaveCount(0);
  await expect(branch(page)).toBeFocused();
  // Mouse input takes over again even without leaving the parent item.
  await page.mouse.move(box.x + 30, box.y + box.height / 2);
  await expect(child(page)).toBeVisible();
});

test("moving through a sibling into an open submenu cancels the delayed close", async ({
  page,
}) => {
  await menuFixture(page);
  await branch(page).hover();
  await expect(child(page)).toBeVisible();
  // Model adjacent moves in one browser task, before the close timer can fire.
  await page.evaluate(() => {
    const panels = document.querySelectorAll('[role="menu"]');
    const sibling = panels[0].querySelector('[role="menuitem"]:last-child');
    const child = panels[1].querySelector('[role="menuitem"]');
    for (const node of [sibling, child]) {
      node.dispatchEvent(
        new PointerEvent("pointerenter", { pointerType: "mouse" }),
      );
      node.dispatchEvent(
        new PointerEvent("pointermove", {
          pointerType: "mouse",
          bubbles: true,
        }),
      );
    }
  });
  await pause(page);
  await expect(child(page)).toBeVisible();
  await expect(child(page)).toBeFocused();
  await page
    .getByRole("menuitem", { name: "Last action", exact: true })
    .hover();
  await expect(child(page)).toHaveCount(0);
  await expect(branch(page)).toHaveAttribute("aria-expanded", "false");
});

test("touch movement leaves hover alone and an explicit press still opens the submenu", async ({
  page,
  hasTouch,
}) => {
  await menuFixture(page);
  await branch(page).dispatchEvent("pointermove", {
    pointerType: "touch",
    bubbles: true,
  });
  await pause(page);
  await expect(child(page)).toHaveCount(0);
  await expect(
    page.getByRole("menuitem", { name: "First action", exact: true }),
  ).toBeFocused();
  if (hasTouch) await branch(page).tap();
  else await branch(page).click();
  await expect(child(page)).toBeFocused();
  if (hasTouch) await child(page).tap();
  else await child(page).click();
  await expect(page.locator("#result")).toHaveText("Chosen");
  await expect(page.getByRole("menu")).toHaveCount(0);
});

test("moving away after choosing a sibling still closes the old submenu", async ({
  page,
}) => {
  await menuFixture(page);
  await branch(page).hover();
  await expect(child(page)).toBeVisible();
  await page
    .getByRole("menuitem", { name: "Last action", exact: true })
    .hover();
  await page.mouse.move(0, 0);
  await expect(child(page)).toHaveCount(0);
  await expect(branch(page)).toHaveAttribute("aria-expanded", "false");
});
