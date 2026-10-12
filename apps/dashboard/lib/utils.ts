import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatDate(date: string | Date | null | undefined) {
  if (!date) return '—';
  const d = new Date(date);
  if (isNaN(d.getTime())) return '—';
  return new Intl.DateTimeFormat('en-GB', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(d);
}

export function truncate(str: string, maxLen = 80) {
  return str.length > maxLen ? `${str.slice(0, maxLen)}…` : str;
}

export const STATUS_COLOURS: Record<string, string> = {
  ACTIVE:            'badge-active',
  DRAFT:             'badge-draft',
  INACTIVE:          'badge-queued',
  PUBLISHED:         'badge-published',
  DEPRECATED:        'badge-failed',
  PENDING_REVIEW:    'badge-waiting',
  QUEUED:            'badge-queued',
  RUNNING:           'badge-running',
  AWAITING_APPROVAL: 'badge-waiting',
  COMPLETED:         'badge-completed',
  FAILED:            'badge-failed',
  CANCELLED:         'badge-queued',
  AUTONOMOUS:        'badge-autonomous',
  SUPERVISED:        'badge-supervised',
  DELIBERATE:        'badge-deliberate',
};
