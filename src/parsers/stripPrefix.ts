/**
 * Strips non-XML prefix lines from Mozaik .dat file content.
 *
 * Mozaik files prepend metadata lines (version numbers, export headers)
 * before the XML declaration or root element. Examples:
 *   - "7\n<?xml ...>"
 *   - "Mozaik Door Export\n7\n<?xml ...>"
 *   - "4\n<?xml ...>"
 */
export function stripPrefix(raw: string): string {
  const lines = raw.split(/\r?\n/);
  const xmlStartIndex = lines.findIndex(
    (line) => {
      const trimmed = line.trimStart();
      return trimmed.startsWith('<?xml') || trimmed.startsWith('<');
    }
  );
  if (xmlStartIndex === -1) {
    throw new Error('No XML content found in file');
  }
  return lines.slice(xmlStartIndex).join('\n');
}
