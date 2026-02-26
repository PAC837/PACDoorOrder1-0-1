import { XMLParser } from 'fast-xml-parser';
import { z } from 'zod';
import { stripPrefix } from './stripPrefix.js';
import { LibraryDoorSchema } from '../schemas/DoorSchema.js';
import type { LibraryDoor } from '../schemas/DoorSchema.js';

const ARRAY_ELEMENTS = new Set([
  'LibraryDoor',
  'ShapePoint',
  'OperationPocket',
  'OperationToolPathNode',
  'Divider',
  'SubPanel',
]);

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '',
  parseAttributeValue: false,
  isArray: (name) => ARRAY_ELEMENTS.has(name),
});

const DoorLibraryRawSchema = z.object({
  DoorLibrary: z.object({
    LibraryDoor: z.array(LibraryDoorSchema),
  }),
});

export function parseDoors(raw: string): LibraryDoor[] {
  const xml = stripPrefix(raw);
  const parsed = parser.parse(xml);
  return DoorLibraryRawSchema.parse(parsed).DoorLibrary.LibraryDoor;
}
