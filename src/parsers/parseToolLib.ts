import { XMLParser } from 'fast-xml-parser';
import { z } from 'zod';
import { stripPrefix } from './stripPrefix.js';
import { ToolSchema } from '../schemas/ToolSchema.js';
import type { Tool } from '../schemas/ToolSchema.js';

const ARRAY_ELEMENTS = new Set([
  'Tool',
  'ShapePoint',
]);

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '',
  parseAttributeValue: false,
  isArray: (name) => ARRAY_ELEMENTS.has(name),
});

const ToolLibraryRawSchema = z.object({
  ToolLibrary: z.object({
    Tool: z.array(ToolSchema),
  }),
});

export function parseToolLib(raw: string): Tool[] {
  const xml = stripPrefix(raw);
  const parsed = parser.parse(xml);
  return ToolLibraryRawSchema.parse(parsed).ToolLibrary.Tool;
}
