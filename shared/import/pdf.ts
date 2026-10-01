import { getDocumentProxy } from 'unpdf';
import type { TextItem } from './chase-statement.ts';

/** Positioned text from every page of a PDF. Runs in Node and in the browser (unpdf ships a serverless pdf.js). */
export async function extractTextItems(bytes: Uint8Array): Promise<TextItem[]> {
  const pdf = await getDocumentProxy(bytes, { verbosity: 0 });
  const items: TextItem[] = [];
  for (let page = 1; page <= pdf.numPages; page++) {
    const content = await (await pdf.getPage(page)).getTextContent();
    for (const item of content.items) {
      if ('str' in item && item.str.trim()) {
        items.push({ page, x: Math.round(item.transform[4]), y: Math.round(item.transform[5]), text: item.str });
      }
    }
  }
  return items;
}
