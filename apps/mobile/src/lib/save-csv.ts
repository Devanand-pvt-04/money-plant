import { Directory } from 'expo-file-system';
import type { ExportResult } from './export';

/**
 * Writes the export's CSV files into a folder the user picks with Android's
 * folder picker; null when they close it. The files are built only after a
 * folder is picked. The web build uses save-csv.web.ts.
 */
export async function saveCsvFiles(stamp: string, build: () => Promise<[string, string][]>): Promise<ExportResult | null> {
  let folder: Directory;
  try {
    folder = await Directory.pickDirectoryAsync();
  } catch {
    return null;
  }
  const files = await build();
  const written: string[] = [];
  for (const [name, csv] of files) {
    const file = folder.createFile(`money-plant-${name}-${stamp}.csv`, 'text/csv');
    await file.write(csv);
    written.push(file.name);
  }
  return { folder: folder.name, files: written };
}
