// Type declaration for three.js' (MIT) USD crate parser, which ships without typings.
declare module 'three/examples/jsm/loaders/usd/USDCParser.js' {
  export class USDCParser {
    parseData(buffer: ArrayBuffer): { specsByPath: Record<string, { specType: number; fields: Record<string, unknown> }> };
  }
}
