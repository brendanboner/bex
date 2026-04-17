import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatDate(date: string | Date) {
  return new Intl.DateTimeFormat('en-GB', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(date));
}

export function truncate(str: string, maxLen = 80) {
  return str.length > maxLen ? `${str.slice(0, maxLen)}…` : str;
}

export const STATUS_COLOURS: Record<string, string> = {
  ACTIVE: 'bg-green-100 text-green-800',
  DRAFT: 'bg-yellow-100 text-yellow-800',
  INACTIVE: 'bg-gray-100 text-gray-700',
  PUBLISHED: 'bg-blue-100 text-blue-800',
  DEPRECATED: 'bg-red-100 text-red-700',
  PENDING_REVIEW: 'bg-orange-100 text-orange-800',
  QUEUED: 'bg-gray-100 text-gray-700',
  RUNNING: 'bg-blue-100 text-blue-800',
  AWAITING_APPROVAL: 'bg-yellow-100 text-yellow-800',
  COMPLETED: 'bg-green-100 text-green-800',
  FAILED: 'bg-red-100 text-red-700',
  CANCELLED: 'bg-gray-100 text-gray-600',
};
