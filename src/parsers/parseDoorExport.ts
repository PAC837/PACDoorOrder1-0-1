import { XMLParser } from 'fast-xml-parser';
import { stripPrefix } from './stripPrefix.js';
import { LibraryDoorSchema } from '../schemas/DoorSchema.js';
import type { LibraryDoor } from '../schemas/DoorSchema.js';

const ARRAY_ELEMENTS = new Set([
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

/**
 * Parse an individual Mozaik door export file.
 * These files have a "Mozaik Door Export\n7\n" prefix and a bare
 * <LibraryDoor> root element (not wrapped in <DoorLibrary>).
 */
export function parseDoorExport(raw: string): LibraryDoor {
  const xml = stripPrefix(raw);
  const parsed = parser.parse(xml);
  return LibraryDoorSchema.parse(parsed.LibraryDoor);
}
