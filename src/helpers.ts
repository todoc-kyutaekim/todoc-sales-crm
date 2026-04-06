// Activity log helper
export async function logActivity(db: D1Database, action: string, entityType: string, entityId: number | null, entityName: string, details: string = '') {
  try {
    await db.prepare('INSERT INTO activity_log (action, entity_type, entity_id, entity_name, details) VALUES (?,?,?,?,?)')
      .bind(action, entityType, entityId, entityName, details).run()
  } catch (e) { /* ignore logging errors */ }
}

// Sanitize integer param
export function safeInt(v: string | undefined | null, fallback: number = 0): number {
  if (!v) return fallback
  const n = parseInt(v, 10)
  return isNaN(n) ? fallback : n
}

// Sanitize limit
export function safeLimit(v: string | undefined | null, max: number = 100): number {
  const n = safeInt(v, max)
  return Math.min(Math.max(n, 1), max)
}

// Strip dangerous characters for LIKE queries
export function safeLike(v: string): string {
  return v.replace(/[%_]/g, '')
}

// Standardized API error response
export function apiError(c: any, statusCode: number, message: string, code: string) {
  return c.json({ error: message, code }, statusCode)
}

// Common error codes
export const ErrorCodes = {
  VALIDATION: 'VALIDATION_ERROR',
  NOT_FOUND: 'NOT_FOUND',
  UNAUTHORIZED: 'UNAUTHORIZED',
  FORBIDDEN: 'FORBIDDEN',
  CONFLICT: 'CONFLICT',
  INTERNAL: 'INTERNAL_ERROR',
  AI_ERROR: 'AI_ERROR',
  EXTERNAL_API: 'EXTERNAL_API_ERROR',
} as const
