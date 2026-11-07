import type { OpcPackage } from "./package.ts";

/** Roll back part replacements/additions without duplicating immutable media buffers. */
export const withPackageTransaction = <T>(
  pkg: OpcPackage,
  operation: () => T,
): T => {
  const parts = pkg.parts.map((part) => ({
    part,
    data: part.data,
    contentType: part.contentType,
  }));
  const types = {
    ...pkg.contentTypes,
    defaults: pkg.contentTypes.defaults.map((e) => ({ ...e })),
    overrides: pkg.contentTypes.overrides.map((e) => ({ ...e })),
  };
  try {
    return operation();
  } catch (error) {
    pkg.parts.length = 0;
    for (const { part, data, contentType } of parts) {
      part.data = data;
      part.contentType = contentType;
      pkg.parts.push(part);
    }
    pkg.contentTypes = types;
    throw error;
  }
};
