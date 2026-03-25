import { XMLParser } from 'fast-xml-parser';
import { readFileSync } from 'fs';
import { resolve } from 'path';

export interface FeedSource {
  title: string;
  xmlUrl: string;
  htmlUrl?: string;
}

export function parseOpml(opmlPath: string, folderName: string): FeedSource[] {
  const xml = readFileSync(resolve(opmlPath), 'utf-8');
  const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_' });
  const parsed = parser.parse(xml);

  const body = parsed.opml.body;
  const folders = Array.isArray(body.outline) ? body.outline : [body.outline];

  const folder = folders.find(
    (f: any) => f['@_text'] === folderName || f['@_title'] === folderName
  );

  if (!folder) {
    throw new Error(`Folder "${folderName}" not found in OPML`);
  }

  const outlines = Array.isArray(folder.outline) ? folder.outline : [folder.outline];

  return outlines
    .filter((o: any) => o['@_type'] === 'rss' && o['@_xmlUrl'])
    .map((o: any) => ({
      title: o['@_text'] || o['@_title'] || 'Unknown',
      xmlUrl: o['@_xmlUrl'],
      htmlUrl: o['@_htmlUrl'] || undefined,
    }));
}
