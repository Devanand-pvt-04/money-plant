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

export class PdfError extends Error {
  constructor(readonly code: PdfErrorCode) {
    super(code);
  }
}

/**
 * Sends a PDF and its password to one of the parser edge functions (parse-cas,
 * parse-statement) and returns what it read. Nothing is stored on the way.
 * The parser sleeps when idle, so the first call can take about a minute.
 */
export async function sendPdf<T>(fn: 'parse-cas' | 'parse-statement', file: { uri: string; name: string }, password: string): Promise<T> {
  const form = new FormData();
  // React Native's FormData sends a file from its uri.
  form.append('file', { uri: file.uri, name: file.name || 'statement.pdf', type: 'application/pdf' } as unknown as Blob);
  form.append('password', password);
  const { data, error } = await supabase.functions.invoke<T>(fn, { body: form });
  if (error) {
    let code: PdfErrorCode = 'service_unavailable';
    if (error instanceof FunctionsHttpError) {
      const body = await (error.context as Response).json().catch(() => null);
      const detail = body?.error ?? body?.detail;
      code = CODES.find((c) => c === detail) ?? 'unknown';
    }
    throw new PdfError(code);
  }
  if (!data) throw new PdfError('unknown');
  return data;
}
