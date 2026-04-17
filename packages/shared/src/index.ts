import type { ApiError, ApiResponse, ApiSuccess } from './types/index.js';

export * from './schemas/index.js';
export * from './types/index.js';

// ─── Response helpers ─────────────────────────────────────────────────────────

export function ok<T>(data: T): ApiSuccess<T> {
  return { ok: true, data };
}

export function err(code: string, message: string, details?: unknown): ApiError {
  return { ok: false, error: { code, message, details } };
}

export function isOk<T>(res: ApiResponse<T>): res is ApiSuccess<T> {
  return res.ok;
}

// ─── Error codes ──────────────────────────────────────────────────────────────

export const ErrorCodes = {
  NOT_FOUND: 'NOT_FOUND',
  UNAUTHORIZED: 'UNAUTHORIZED',
  FORBIDDEN: 'FORBIDDEN',
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  CONFLICT: 'CONFLICT',
  SKILL_NOT_FOUND: 'SKILL_NOT_FOUND',
  CREDENTIAL_NOT_FOUND: 'CREDENTIAL_NOT_FOUND',
  APPROVAL_REQUIRED: 'APPROVAL_REQUIRED',
  APPROVAL_DENIED: 'APPROVAL_DENIED',
  APPROVAL_EXPIRED: 'APPROVAL_EXPIRED',
  LLM_ERROR: 'LLM_ERROR',
  TOOL_EXECUTION_ERROR: 'TOOL_EXECUTION_ERROR',
  INTERNAL: 'INTERNAL',
} as const;

export type ErrorCode = (typeof ErrorCodes)[keyof typeof ErrorCodes];
