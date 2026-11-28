// Web build (decision 0039): an iPhone home screen web app can't schedule local
// notifications; budget alerts and reminders need server-sent web push, a later
// phase. Same exports as notifications.ts, doing nothing.
type Channel = 'budgets' | 'reminders';

export async function requestNotificationPermission(): Promise<boolean> {
  return false;
}

export async function notify(_input: { channel: Channel; title: string; body: string; data?: Record<string, string> }): Promise<void> {}

export async function notifyAt(_input: {
  id: string;
  channel: Channel;
  at: Date;
  title: string;
  body: string;
  data?: Record<string, string>;
}): Promise<void> {}

export async function cancelScheduled(_prefix: string): Promise<void> {}
