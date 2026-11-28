import type { ExportResult } from './export';

/**
 * Web build (decision 0039): the export's CSV files in one zip file, downloaded
 * by the browser. Safari asks only once for one file, and on an iPhone it lands
 * in Files, Downloads, where a tap opens the CSVs.
 */
export async function saveCsvFiles(stamp: string, build: () => Promise<[string, string][]>): Promise<ExportResult | null> {
  const files = (await build()).map(([name, csv]) => ({ name: `money-plant-${name}-${stamp}.csv`, data: new TextEncoder().encode(csv) }));
  const zip = new Blob([storedZip(files)], { type: 'application/zip' });
  const url = URL.createObjectURL(zip);
  const link = document.createElement('a');
  link.href = url;
  link.download = `money-plant-export-${stamp}.zip`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
  return { folder: 'Downloads', files: files.map((f) => f.name) };
}

/** A zip file with the files stored as they are (no compression), which every unzip tool opens. */
function storedZip(files: { name: string; data: Uint8Array }[]): Uint8Array<ArrayBuffer> {
  const parts: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  for (const file of files) {
    const name = new TextEncoder().encode(file.name);
    const crc = crc32(file.data);
    const local = header(30 + name.length, (v) => {
      v.setUint32(0, 0x04034b50, true);
      v.setUint16(4, 20, true); // version needed
      v.setUint16(6, 0x0800, true); // UTF-8 names
      v.setUint32(14, crc, true);
      v.setUint32(18, file.data.length, true);
      v.setUint32(22, file.data.length, true);
      v.setUint16(26, name.length, true);
    });
    local.set(name, 30);
    central.push(
      (() => {
        const entry = header(46 + name.length, (v) => {
          v.setUint32(0, 0x02014b50, true);
          v.setUint16(4, 20, true);
          v.setUint16(6, 20, true);
          v.setUint16(8, 0x0800, true);
          v.setUint32(16, crc, true);
          v.setUint32(20, file.data.length, true);
          v.setUint32(24, file.data.length, true);
          v.setUint16(28, name.length, true);
          v.setUint32(42, offset, true);
        });
        entry.set(name, 46);
        return entry;
      })(),
    );
    parts.push(local, file.data);
    offset += local.length + file.data.length;
  }
  const centralSize = central.reduce((s, c) => s + c.length, 0);
  const end = header(22, (v) => {
    v.setUint32(0, 0x06054b50, true);
    v.setUint16(8, files.length, true);
    v.setUint16(10, files.length, true);
    v.setUint32(12, centralSize, true);
    v.setUint32(16, offset, true);
  });
  const all = [...parts, ...central, end];
  const out = new Uint8Array(all.reduce((s, p) => s + p.length, 0));
  let at = 0;
  for (const p of all) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

function header(size: number, fill: (view: DataView) => void): Uint8Array {
  const bytes = new Uint8Array(size);
  fill(new DataView(bytes.buffer));
  return bytes;
}

let table: Uint32Array | null = null;

function crc32(data: Uint8Array): number {
  if (!table) {
    table = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      table[n] = c >>> 0;
    }
  }
  let crc = 0xffffffff;
  for (const byte of data) crc = table[(crc ^ byte) & 0xff]! ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}
