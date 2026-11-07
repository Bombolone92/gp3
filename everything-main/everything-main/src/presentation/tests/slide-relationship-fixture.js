import { P } from "../src/model.js";
import { createNumberedDeck } from "./slide-number-fixture.js";
import {
  partName,
  relsPartNameFor,
  resolveTarget,
} from "../lib/pptx/src/internal/opc/index.ts";

export async function createSlideRelationshipDeck({
  targets = "absolute",
  relocated = false,
} = {}) {
  const pres = await P.loadPresentation(
    await createNumberedDeck({ start: 7, count: 3 }),
  );
  const pkg = P._internalPackageOf(pres);
  const rels = pkg.getRels("/ppt/presentation.xml");
  const slides = rels.items.filter((r) => r.type.endsWith("/slide"));
  for (const [i, rel] of slides.entries()) {
    let target = resolveTarget(partName("/ppt/presentation.xml"), rel.target);
    if (relocated && i === 0) {
      const next = partName("/extras/chapter%20one/slides/slide1.xml");
      const old = pkg.getPart(target);
      const dependencies = pkg.getRels(target);
      pkg.addPart(next, old.contentType, old.data.slice());
      if (dependencies)
        pkg.setRels(next, {
          items: dependencies.items.map((r) => ({
            ...r,
            target:
              r.targetMode === "External"
                ? r.target
                : resolveTarget(target, r.target),
          })),
        });
      pkg.removePart(relsPartNameFor(target));
      pkg.removePart(target);
      target = next;
    }
    rel.target =
      targets === "absolute"
        ? target
        : targets === "case"
          ? target.toUpperCase()
          : targets === "dot"
            ? `./${target.slice(5)}`
            : targets === "parent"
              ? `../${target.slice(1)}`
              : target.slice(5);
  }
  pkg.setRels("/ppt/presentation.xml", rels);
  return P.savePresentation(pres);
}
