import { XMLParser } from 'fast-xml-parser';
import { z } from 'zod';
import { stripPrefix } from './stripPrefix.js';
import { ToolGroupSchema } from '../schemas/ToolGroupSchema.js';
import type { ToolGroup } from '../schemas/ToolGroupSchema.js';

const ARRAY_ELEMENTS = new Set([
  'ToolGroup',
  'ToolEntry',
]);

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '',
  parseAttributeValue: false,
  isArray: (name) => ARRAY_ELEMENTS.has(name),
});

const ToolGroupsRawSchema = z.object({
  ToolGroups: z.object({
    ToolGroup: z.array(ToolGroupSchema),
  }),
});

export function parseToolGroups(raw: string): ToolGroup[] {
  const xml = stripPrefix(raw);
  const parsed = parser.parse(xml);
  return ToolGroupsRawSchema.parse(parsed).ToolGroups.ToolGroup;
}
