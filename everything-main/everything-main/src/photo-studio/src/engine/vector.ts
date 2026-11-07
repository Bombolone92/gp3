import initialize, { type PathKit, type SkPath } from "pathkit-wasm";
import wasmUrl from "pathkit-wasm/bin/pathkit.wasm?url";
import {
  identityVectorMatrix,
  validateVectorMask,
  validateVectorViewport,
  vectorComponents,
  linearVectorSegment,
  type VectorMask,
  type VectorMatrix,
  type VectorRaster,
  type FloatVectorRaster,
} from "../model/vector";
import type { Rect } from "../model/document";
import { vectorCoverage } from "./vector-coverage";
import {
  strokePixels,
  strokeDashRuns,
  validateVectorStroke,
  supportedStrokePaths,
  type VectorStroke,
} from "../model/vector-stroke";

export type StrokeRaster = FloatVectorRaster & {
  strokeCoverage: Float32Array;
  overlapCoverage: Float32Array;
  strokePath: string;
  strokeRule: CanvasFillRule;
};

let toolkit: Promise<PathKit> | undefined;
function ready() {
  return (toolkit ??= initialize({ locateFile: () => wasmUrl }).catch(
    (error) => {
      toolkit = undefined;
      throw error;
    },
  ));
}

export async function rasterVectorMask(
  mask: VectorMask,
  viewport: Rect,
  matrix: VectorMatrix = identityVectorMatrix,
  floating = false,
  stroke?: VectorStroke,
): Promise<VectorRaster | FloatVectorRaster | StrokeRaster> {
  validateVectorMask(mask);
  validateVectorViewport(viewport, matrix);
  if (stroke) {
    validateVectorStroke(stroke);
    if (!supportedStrokePaths(mask, stroke))
      throw new Error("Unsupported vector stroke path operations.");
    // Three float area buffers, combined alpha and the RGBA paint buffer.
    if (viewport.width * viewport.height * 32 > 512 * 1024 * 1024)
      throw new Error("Vector stroke exceeds the geometry pixel budget.");
  }
  const kit = await ready();
  const owned: SkPath[] = [];
  const make = () => {
    const path = kit.NewPath();
    owned.push(path);
    return path;
  };
  const plane = () => make().rect(0, 0, viewport.width, viewport.height);
  const copy = (path: SkPath) => {
    const result = path.copy();
    owned.push(result);
    return result;
  };
  const point = (x: number, y: number): [number, number] => {
    const result: [number, number] = [
      matrix[0] * x + matrix[2] * y + matrix[4] - viewport.x,
      matrix[1] * x + matrix[3] * y + matrix[5] - viewport.y,
    ];
    if (!result.every((n) => Number.isFinite(Math.fround(n))))
      throw new Error("Vector coordinates exceed the geometry engine range.");
    return result;
  };
  const apply = (destination: SkPath, source: SkPath, operation: object) => {
    if (!destination.op(source, operation))
      throw new Error("The vector path operation could not be resolved.");
  };
  try {
    const components = vectorComponents(mask);
    // PSD shape operations subtract/intersect on the first component start
    // from the plane. Otherwise they would produce an empty shape. The initial
    // fill record also defines masks with no component (PSD path record selector 8).
    let outside =
      mask.disable ||
      mask.fillStartsWithAllPixels ||
      ["subtract", "intersect"].includes(components[0]?.operation);
    // Represent unbounded regions as the complement of finite geometry. A
    // viewport edge is never an editable contour and must never acquire a
    // stroke. This also keeps inversion independent of the render viewport.
    let resolved = make();
    let openPath: SkPath | undefined;
    let singlePath: SkPath | undefined;
    if (!mask.disable) {
      for (const component of components) {
        const path = make();
        path.setFillType(
          component.paths[0].fillRule === "non-zero"
            ? kit.FillType.WINDING
            : kit.FillType.EVENODD,
        );
        for (const contour of component.paths) {
          const knots = contour.knots;
          if (!knots.length) continue;
          path.moveTo(...point(knots[0].points[2], knots[0].points[3]));
          for (let i = 1; i < knots.length; i++) {
            const a = knots[i - 1].points,
              b = knots[i].points;
            if (linearVectorSegment(a, b)) path.lineTo(...point(b[2], b[3]));
            else
              path.cubicTo(
                ...point(a[4], a[5]),
                ...point(b[0], b[1]),
                ...point(b[2], b[3]),
              );
          }
          if (!contour.open) {
            const a = knots[knots.length - 1].points,
              b = knots[0].points;
            if (linearVectorSegment(a, b)) path.lineTo(...point(b[2], b[3]));
            else
              path.cubicTo(
                ...point(a[4], a[5]),
                ...point(b[0], b[1]),
                ...point(b[2], b[3]),
              );
            path.close();
          }
          // Canvas/Skia close open contours for fill, while retaining the open
          // source record for later stroke rendering and editable export.
        }
        if (
          stroke &&
          mask.paths.length === 1 &&
          (mask.paths[0].open || stroke.lineDashSet?.length)
        ) {
          singlePath = copy(path);
          if (mask.paths[0].open) openPath = singlePath;
        }
        const operation = component.operation;
        if (outside && operation === "intersect") {
          apply(path, resolved, kit.PathOp.DIFFERENCE);
          resolved = path;
          outside = false;
        } else {
          apply(
            resolved,
            path,
            {
              combine: outside ? kit.PathOp.DIFFERENCE : kit.PathOp.UNION,
              subtract: outside ? kit.PathOp.UNION : kit.PathOp.DIFFERENCE,
              intersect: kit.PathOp.INTERSECT,
              exclude: kit.PathOp.XOR,
            }[operation],
          );
        }
      }
    }
    // The render surface clips coverage to the requested viewport. Avoid a
    // gratuitous geometric intersection with that rectangle: splitting cubics
    // at its edge changes scan-conversion subdivision and edge rounding.
    // Off-canvas controls and contours remain intact. Boolean ops precede antialiasing:
    // multiplying raster coverages leaves fringes for identical XOR/subtract.
    outside = mask.disable ? true : mask.invert ? !outside : outside;
    let fillRule = resolved.getFillTypeString();
    const areas = vectorCoverage(
      resolved.toCmds(),
      viewport.width,
      viewport.height,
      fillRule,
    );
    const coverage = floating ? areas : new Uint8Array(areas.length);
    const invert = outside;
    // Complement commutes with pixel-area integration: coverage(!shape) is
    // exactly 1 - coverage(shape). Invert the coverage directly so a second
    // scan conversion cannot introduce asymmetric edge rounding. This identity
    // does not hold for union/intersect/XOR, which must resolve geometry first.
    for (let i = 0; i < coverage.length; i++)
      coverage[i] = floating
        ? invert
          ? 1 - areas[i]
          : areas[i]
        : invert
          ? 255 - Math.round(areas[i] * 255)
          : Math.round(areas[i] * 255);
    let strokeResult: Omit<StrokeRaster, keyof FloatVectorRaster> | undefined;
    if (stroke) {
      let outline = make();
      const width = strokePixels(stroke);
      if (stroke.enabled && !mask.disable && width > 0) {
        // Preserve the original dash origin/direction rather than using the
        // equivalent, but potentially reordered, boolean fill contour.
        const source = stroke.lineDashSet?.length
          ? (singlePath ?? resolved)
          : (openPath ?? resolved);
        const runs = strokeDashRuns(stroke);
        const commands = source.toCmds();
        if (runs.length) {
          // Bound total work across every repeated pair, not just the native
          // binding's per-pair budget. Control polygons bound curve lengths.
          let length = 0,
            contours = 0,
            x = 0,
            y = 0,
            sx = 0,
            sy = 0;
          for (const c of commands) {
            if (c[0] === 0) {
              x = sx = c[1];
              y = sy = c[2];
              contours++;
            } else if (c[0] === 5) {
              length += Math.hypot(x - sx, y - sy);
              x = sx;
              y = sy;
            } else
              for (let i = 1; i < c.length - (c[0] === 3 ? 1 : 0); i += 2) {
                length += Math.hypot(c[i] - x, c[i + 1] - y);
                x = c[i];
                y = c[i + 1];
              }
          }
          if (
            (length / (runs[0].on + runs[0].off) + contours) * runs.length >
            100000
          )
            throw new Error(
              "Vector dashes exceed the geometry segment budget.",
            );
        }
        // Any alternating pattern is the union of independent periodic painted
        // runs. Dash each before stroking so endpoints, seam joins and caps are
        // geometric; union the outlines before antialiasing or applying opacity.
        // Zero gaps were merged in the model, preserving continuous joins.
        for (const run of runs.length ? runs : [undefined]) {
          const part = copy(source);
          // PathKit fixes both measuring/stroking tolerance at document scale.
          // Scaling bounds curved dash endpoints as well as offset curves.
          const scale = 1024;
          part.transform([scale, 0, 0, 0, scale, 0, 0, 0, 1]);
          if (
            !part.toCmds().every((c) => c.every(Number.isFinite)) ||
            !Number.isFinite(Math.fround(width * scale * 2))
          )
            throw new Error("Vector stroke exceeds the geometry engine range.");
          if (run) {
            const on = Math.fround(run.on * scale),
              off = Math.fround(run.off * scale),
              phase = Math.fround(run.phase * scale) % Math.fround(on + off);
            if (
              !(on > 0 && off > 0) ||
              ![on, off, phase].every(Number.isFinite) ||
              !part.dash(on, off, phase)
            )
              throw new Error("The vector dash pattern could not be resolved.");
          }
          const squarePaths = stroke.cap === "square" ? part.toCmds() : [];
          const inkWidth =
            width * scale * (stroke.alignment === "center" ? 1 : 2);
          if (
            !part.stroke({
              width: inkWidth,
              miter_limit: stroke.miterLimit,
              cap:
                stroke.cap === "round"
                  ? kit.StrokeCap.ROUND
                  : kit.StrokeCap.BUTT,
              join: {
                miter: kit.StrokeJoin.MITER,
                round: kit.StrokeJoin.ROUND,
                bevel: kit.StrokeJoin.BEVEL,
              }[stroke.join],
            })
          )
            throw new Error("The vector stroke could not be resolved.");
          if (squarePaths.length) {
            // The pinned Skia square cap can mutate a curved endpoint when a
            // contour ends with a line. Apply exact tangent rectangles at every
            // open contour's endpoints, including the new dashed contours.
            let points: number[][] = [];
            const caps = () => {
              for (const sequence of [points, [...points].reverse()]) {
                const p = sequence[0],
                  q = sequence.find((q) => q[0] !== p[0] || q[1] !== p[1]);
                if (!p || !q) continue;
                const length = Math.hypot(p[0] - q[0], p[1] - q[1]),
                  dx = (((p[0] - q[0]) / length) * inkWidth) / 2,
                  dy = (((p[1] - q[1]) / length) * inkWidth) / 2,
                  cap = make()
                    .moveTo(p[0] - dy, p[1] + dx)
                    .lineTo(p[0] + dy, p[1] - dx)
                    .lineTo(p[0] + dy + dx, p[1] - dx + dy)
                    .lineTo(p[0] - dy + dx, p[1] + dx + dy)
                    .close();
                apply(part, cap, kit.PathOp.UNION);
                cap.delete();
                owned.pop();
              }
              points = [];
            };
            for (const c of squarePaths) {
              if (c[0] === 0) {
                caps();
                points = [[c[1], c[2]]];
              } else if (c[0] === 5)
                points = []; // Closed contours have joins.
              else
                for (let i = 1; i < c.length - (c[0] === 3 ? 1 : 0); i += 2)
                  points.push([c[i], c[i + 1]]);
            }
            caps();
          }
          part.transform([1 / scale, 0, 0, 0, 1 / scale, 0, 0, 0, 1]);
          part.setFillType(kit.FillType.WINDING);
          if (runs.length) apply(outline, part, kit.PathOp.UNION);
          else outline = part;
        }
        if (stroke.alignment !== "center") {
          const inside = stroke.alignment === "inside";
          apply(
            outline,
            resolved,
            inside !== outside ? kit.PathOp.INTERSECT : kit.PathOp.DIFFERENCE,
          );
        }
      }
      const overlap = copy(outline);
      if (stroke.fillEnabled)
        apply(
          overlap,
          resolved,
          outside ? kit.PathOp.DIFFERENCE : kit.PathOp.INTERSECT,
        );
      else apply(overlap, overlap, kit.PathOp.DIFFERENCE);
      strokeResult = {
        strokeCoverage: vectorCoverage(
          outline.toCmds(),
          viewport.width,
          viewport.height,
          outline.getFillTypeString(),
        ),
        overlapCoverage: vectorCoverage(
          overlap.toCmds(),
          viewport.width,
          viewport.height,
          overlap.getFillTypeString(),
        ),
        strokePath: outline.toSVGString(),
        strokeRule: outline.getFillTypeString(),
      };
      if (!stroke.fillEnabled) coverage.fill(0);
    }
    if (invert) {
      const inverted = plane();
      apply(inverted, resolved, kit.PathOp.DIFFERENCE);
      resolved = inverted;
      fillRule = resolved.getFillTypeString();
    }
    return {
      viewport: { ...viewport },
      coverage,
      path: resolved.toSVGString(),
      fillRule,
      ...strokeResult,
    } as VectorRaster | FloatVectorRaster;
  } finally {
    // Embind objects own WASM memory; JS garbage collection does not release it.
    for (const path of owned) path.delete();
  }
}
