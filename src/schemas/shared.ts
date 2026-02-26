import { z } from 'zod';

/** Coerce XML attribute string to number. Empty string or undefined → 0. */
export const xmlNum = z.preprocess(
  (v) => (v === '' || v === undefined || v === null ? 0 : Number(v)),
  z.number()
);

/** Coerce XML attribute string to boolean. "True" or true → true, anything else → false. */
export const xmlBool = z.preprocess(
  (v) => v === 'True' || v === true,
  z.boolean()
);

/** String that defaults to empty string if absent. */
export const xmlStr = z.preprocess(
  (v) => (v === undefined || v === null ? '' : String(v)),
  z.string()
);

/** Coerce XML attribute string to integer, preserving -1 sentinel values. Empty → -1. */
export const xmlId = z.preprocess(
  (v) => (v === '' || v === undefined || v === null ? -1 : Number(v)),
  z.number().int()
);

/** Millimeters per inch — exact conversion factor. */
export const MM_PER_INCH = 25.4;
