declare module "pathkit-wasm" {
  export interface SkPath {
    moveTo(x: number, y: number): SkPath;
    lineTo(x: number, y: number): SkPath;
    cubicTo(
      x1: number,
      y1: number,
      x2: number,
      y2: number,
      x: number,
      y: number,
    ): SkPath;
    close(): SkPath;
    rect(x: number, y: number, width: number, height: number): SkPath;
    setFillType(type: object): void;
    op(path: SkPath, operation: object): SkPath | null;
    toSVGString(): string;
    toCmds(): number[][];
    toPath2D(): Path2D;
    getFillTypeString(): CanvasFillRule;
    copy(): SkPath;
    dash(on: number, off: number, phase: number): SkPath | null;
    transform(matrix: number[]): SkPath;
    stroke(options: {
      width: number;
      miter_limit: number;
      cap: object;
      join: object;
    }): SkPath | null;
    delete(): void;
  }
  export interface PathKit {
    NewPath(): SkPath;
    FillType: { WINDING: object; EVENODD: object };
    StrokeCap: { BUTT: object; ROUND: object; SQUARE: object };
    StrokeJoin: { MITER: object; ROUND: object; BEVEL: object };
    PathOp: {
      DIFFERENCE: object;
      INTERSECT: object;
      UNION: object;
      XOR: object;
    };
  }
  export default function initialize(options: {
    locateFile(file: string): string;
  }): Promise<PathKit>;
}
