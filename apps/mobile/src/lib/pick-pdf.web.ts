import type { PdfFile } from './pdf-service';

/**
 * Web build (decision 0039): the browser's file picker for one PDF, which on
 * an iPhone offers Files, iCloud Drive and Downloads. Null when cancelled.
 */
export function pickPdf(): Promise<PdfFile | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'application/pdf,.pdf';
    input.style.display = 'none';
    document.body.appendChild(input);
    const finish = (file: PdfFile | null) => {
      input.remove();
      resolve(file);
    };
    input.addEventListener('change', () => {
      const picked = input.files?.[0];
      finish(picked ? { name: picked.name, base64: () => readBase64(picked) } : null);
    });
    input.addEventListener('cancel', () => finish(null));
    input.click();
  });
}

/** The file as base64, without the "data:...;base64," prefix. */
function readBase64(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).replace(/^data:[^,]*,/, ''));
    reader.onerror = () => reject(reader.error ?? new Error('Could not read the file'));
    reader.readAsDataURL(file);
  });
}
