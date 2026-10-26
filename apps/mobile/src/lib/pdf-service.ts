import { FunctionsHttpError } from '@supabase/supabase-js';
import { supabase } from './supabase';

/** Why a PDF couldn't be read, from the parser service or its edge function. */
export type PdfErrorCode =
  | 'wrong_password'
  | 'not_a_cas'
  | 'not_a_statement'
  | 'demat_not_supported'
  | 'too_large'
  | 'not_configured'
  | 'service_unavailable'
  | 'unknown';

const CODES: readonly PdfErrorCode[] = ['wrong_password', 'not_a_cas', 'not_a_statement', 'demat_not_supported', 'too_large', 'not_configured', 'service_unavailable'];

/** The parser's limit is 10 MB of PDF; base64 makes it a third bigger on the way. */
const MAX_BYTES = 10 * 1024 * 1024;

export class PdfError extends Error {
  /** What went wrong underneath, shown small under the message so a failure can be reported. */
  constructor(
    readonly code: PdfErrorCode,
    readonly detail: string | null = null,
  ) {
    super(code);
  }
}

/** A picked file (expo-file-system's File). */
export interface PdfFile {
  name: string;
  base64(): Promise<string>;
}

/**
 * Sends a PDF and its password to one of the parser edge functions (parse-cas,
 * parse-statement) and returns what it read. Nothing is stored on the way.
 * The PDF goes as base64 in a JSON body: React Native's multipart upload of a
 * picked content:// file failed before the request left the phone.
 * The parser sleeps when idle, so the first call can take about a minute.
 */
export async function sendPdf<T>(fn: 'parse-cas' | 'parse-statement', file: PdfFile, password: string): Promise<T> {
  let pdf: string;
  try {
    pdf = await file.base64();
  } catch (e) {
    throw new PdfError('unknown', `Couldn't read the file: ${e instanceof Error ? e.message : String(e)}`);
  }
  if (pdf.length * 0.75 > MAX_BYTES) throw new PdfError('too_large');
  const { data, error } = await supabase.functions.invoke<T>(fn, { body: { pdf, password } });
  if (error) {
    if (error instanceof FunctionsHttpError) {
      const response = error.context as Response;
      const body = await response.json().catch(() => null);
      const detail = body?.error ?? body?.detail;
      throw new PdfError(CODES.find((c) => c === detail) ?? 'unknown', `HTTP ${response.status}${typeof detail === 'string' ? ` ${detail}` : ''}`);
    }
    const cause = (error as { context?: unknown }).context;
    throw new PdfError('service_unavailable', `${error.name}: ${cause instanceof Error ? cause.message : error.message}`);
  }
  if (!data) throw new PdfError('unknown', 'Empty response');
  return data;
}
