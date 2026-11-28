import { File } from 'expo-file-system';
import type { PdfFile } from './pdf-service';

/** Opens the phone's file picker for one PDF; null when cancelled. The web build uses pick-pdf.web.ts. */
export async function pickPdf(): Promise<PdfFile | null> {
  const picked = await File.pickFileAsync({ mimeTypes: ['application/pdf'] });
  return picked.canceled ? null : picked.result;
}
