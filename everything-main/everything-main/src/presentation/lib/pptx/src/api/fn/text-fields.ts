import { FIELD_DATE, type PresentationData } from "../_internal-symbols.ts";
import {
  formatDateTimeField,
  type DateFieldOptions,
} from "../../internal/drawingml/date-field.ts";
import type { TextFormat } from "../../internal/drawingml/text-format.ts";

export { formatDateTimeField };
export type { DateFieldOptions };

export interface TextFieldContext extends DateFieldOptions {
  readonly date: Date;
  readonly slideNumber?: number | null;
}

/** Automatic dates update on opening/printing, not continuously like a clock.
 * Return an independent Date so callers cannot change another view's snapshot. */
export function getPresentationFieldDate(pres: PresentationData): Date {
  return new Date((pres[FIELD_DATE] ??= Date.now()));
}

/** Refresh display fields for a new presentation/print session. This does not
 * dirty the package or replace a field's authored cache, ID, or formatting. */
export function refreshPresentationFields(
  pres: PresentationData,
  date = new Date(),
): void {
  const time = date.getTime();
  if (!Number.isFinite(time))
    throw new RangeError("date field requires a valid date");
  pres[FIELD_DATE] = time;
}

/** Shared by visual renderers, text editors and accessible/plain-text readers. */
export function evaluateTextField(
  type: string | null | undefined,
  cached: string,
  format: TextFormat | null | undefined,
  context: TextFieldContext,
): string {
  if (type === "slidenum")
    return context.slideNumber == null ? cached : String(context.slideNumber);
  return (
    formatDateTimeField(type, context.date, format ?? {}, context) ?? cached
  );
}
