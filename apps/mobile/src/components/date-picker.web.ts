/**
 * Web build (decision 0039): the browser's own date picker (or date and time
 * picker when `withTime` is set), the wheel sheet on an iPhone. A hidden input
 * is added for the one pick and removed after it.
 */
export function openPicker(value: Date, withTime: boolean, onChange: (next: Date) => void, limits: { min?: Date; max?: Date }) {
  const input = document.createElement('input');
  input.type = withTime ? 'datetime-local' : 'date';
  const format = (d: Date) => (withTime ? localDateTime(d) : localDate(d));
  input.value = format(value);
  if (limits.min) input.min = format(limits.min);
  if (limits.max) input.max = format(limits.max);
  // Kept on screen but invisible: Safari opens no picker for an input that isn't laid out.
  Object.assign(input.style, { position: 'fixed', left: '50%', top: '50%', width: '1px', height: '1px', opacity: '0', border: '0', padding: '0' });
  document.body.appendChild(input);

  let done = false;
  const finish = () => {
    if (done) return;
    done = true;
    input.remove();
    const picked = parse(input.value, withTime);
    if (!picked) return;
    // A date-only pick keeps the old time of day, as the Android picker does.
    onChange(withTime ? picked : new Date(picked.getFullYear(), picked.getMonth(), picked.getDate(), value.getHours(), value.getMinutes()));
  };
  input.addEventListener('change', finish);
  input.addEventListener('blur', () => setTimeout(finish, 0));

  input.focus();
  try {
    input.showPicker();
  } catch {
    input.click();
  }
}

const pad = (n: number) => String(n).padStart(2, '0');

function localDate(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function localDateTime(d: Date): string {
  return `${localDate(d)}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** "2026-11-28" or "2026-11-28T09:05" in local time; null when cleared. */
function parse(text: string, withTime: boolean): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}))?/.exec(text);
  if (!m) return null;
  const [, y, mo, d, h, mi] = m;
  if (withTime && h === undefined) return null;
  return new Date(Number(y), Number(mo) - 1, Number(d), Number(h ?? 12), Number(mi ?? 0));
}
