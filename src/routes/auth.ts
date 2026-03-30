import { Hono } from 'hono'

type Bindings = { DB: D1Database }
const auth = new Hono<{ Bindings: Bindings }>()

// ===== Crypto helpers (Web Crypto API for Cloudflare Workers) =====
async function hashPassword(password: string): Promise<string> {
  const encoder = new TextEncoder()
  const salt = crypto.getRandomValues(new Uint8Array(16))
  const keyMaterial = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveBits'])
  const derivedBits = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt, iterations: 100000, hash: 'SHA-256' }, keyMaterial, 256)
  const hashArray = new Uint8Array(derivedBits)
  const saltHex = Array.from(salt).map(b => b.toString(16).padStart(2, '0')).join('')
  const hashHex = Array.from(hashArray).map(b => b.toString(16).padStart(2, '0')).join('')
  return saltHex + ':' + hashHex
}

async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [saltHex, hashHex] = stored.split(':')
  if (!saltHex || !hashHex) return false
  const salt = new Uint8Array(saltHex.match(/.{2}/g)!.map(b => parseInt(b, 16)))
  const encoder = new TextEncoder()
  const keyMaterial = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveBits'])
  const derivedBits = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt, iterations: 100000, hash: 'SHA-256' }, keyMaterial, 256)
  const computed = Array.from(new Uint8Array(derivedBits)).map(b => b.toString(16).padStart(2, '0')).join('')
  return computed === hashHex
}

function generateSessionId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32))
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('')
}

// ===== Register =====
auth.post('/register', async (c) => {
  const body = await c.req.json()
  const { name, email, password } = body

  if (!name || typeof name !== 'string' || name.trim().length === 0) {
    return c.json({ error: '이름을 입력해주세요.' }, 400)
  }
  if (!email || typeof email !== 'string') {
    return c.json({ error: '이메일을 입력해주세요.' }, 400)
  }
  if (!password || typeof password !== 'string' || password.length < 6) {
    return c.json({ error: '비밀번호는 6자 이상이어야 합니다.' }, 400)
  }

  const emailLower = email.trim().toLowerCase()

  // Validate @to-doc.com domain
  if (!emailLower.endsWith('@to-doc.com')) {
    return c.json({ error: '가입할 수 없는 이메일입니다.' }, 400)
  }

  // Check duplicate
  const existing = await c.env.DB.prepare('SELECT id FROM users WHERE email=?').bind(emailLower).first()
  if (existing) {
    return c.json({ error: '이미 가입된 이메일입니다.' }, 400)
  }

  const passwordHash = await hashPassword(password)
  const result = await c.env.DB.prepare('INSERT INTO users (name, email, password_hash) VALUES (?,?,?)')
    .bind(name.trim(), emailLower, passwordHash).run()

  // Auto-login after register
  const sessionId = generateSessionId()
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString() // 7 days
  await c.env.DB.prepare('INSERT INTO sessions (id, user_id, expires_at) VALUES (?,?,?)')
    .bind(sessionId, result.meta.last_row_id, expiresAt).run()

  return c.json({
    data: {
      user: { id: result.meta.last_row_id, name: name.trim(), email: emailLower },
      sessionId
    }
  }, 201)
})

// ===== Login =====
auth.post('/login', async (c) => {
  const body = await c.req.json()
  const { email, password } = body

  if (!email || !password) {
    return c.json({ error: '이메일과 비밀번호를 입력해주세요.' }, 400)
  }

  const emailLower = email.trim().toLowerCase()
  const user = await c.env.DB.prepare('SELECT id, name, email, password_hash FROM users WHERE email=?')
    .bind(emailLower).first() as any

  if (!user) {
    return c.json({ error: '이메일 또는 비밀번호가 올바르지 않습니다.' }, 401)
  }

  const valid = await verifyPassword(password, user.password_hash)
  if (!valid) {
    return c.json({ error: '이메일 또는 비밀번호가 올바르지 않습니다.' }, 401)
  }

  // Create session
  const sessionId = generateSessionId()
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString()
  await c.env.DB.prepare('INSERT INTO sessions (id, user_id, expires_at) VALUES (?,?,?)')
    .bind(sessionId, user.id, expiresAt).run()

  // Cleanup expired sessions
  await c.env.DB.prepare('DELETE FROM sessions WHERE expires_at < datetime("now")').run()

  return c.json({
    data: {
      user: { id: user.id, name: user.name, email: user.email },
      sessionId
    }
  })
})

// ===== Session Check (me) =====
auth.get('/me', async (c) => {
  const sessionId = c.req.header('X-Session-Id') || ''
  if (!sessionId) {
    return c.json({ error: 'Unauthorized' }, 401)
  }

  const session = await c.env.DB.prepare(
    'SELECT s.id, s.user_id, s.expires_at, u.name, u.email FROM sessions s JOIN users u ON s.user_id=u.id WHERE s.id=? AND s.expires_at > datetime("now")'
  ).bind(sessionId).first() as any

  if (!session) {
    return c.json({ error: 'Unauthorized' }, 401)
  }

  return c.json({
    data: { id: session.user_id, name: session.name, email: session.email }
  })
})

// ===== Logout =====
auth.post('/logout', async (c) => {
  const sessionId = c.req.header('X-Session-Id') || ''
  if (sessionId) {
    await c.env.DB.prepare('DELETE FROM sessions WHERE id=?').bind(sessionId).run()
  }
  return c.json({ success: true })
})

// ===== Change Password =====
auth.post('/change-password', async (c) => {
  const sessionId = c.req.header('X-Session-Id') || ''
  if (!sessionId) return c.json({ error: 'Unauthorized' }, 401)

  const session = await c.env.DB.prepare(
    'SELECT user_id FROM sessions WHERE id=? AND expires_at > datetime("now")'
  ).bind(sessionId).first() as any
  if (!session) return c.json({ error: 'Unauthorized' }, 401)

  const body = await c.req.json()
  const { currentPassword, newPassword } = body

  if (!currentPassword || !newPassword) {
    return c.json({ error: '현재 비밀번호와 새 비밀번호를 입력해주세요.' }, 400)
  }
  if (newPassword.length < 6) {
    return c.json({ error: '새 비밀번호는 6자 이상이어야 합니다.' }, 400)
  }

  const user = await c.env.DB.prepare('SELECT password_hash FROM users WHERE id=?')
    .bind(session.user_id).first() as any
  if (!user) return c.json({ error: '사용자를 찾을 수 없습니다.' }, 404)

  const valid = await verifyPassword(currentPassword, user.password_hash)
  if (!valid) {
    return c.json({ error: '현재 비밀번호가 올바르지 않습니다.' }, 400)
  }

  const newHash = await hashPassword(newPassword)
  await c.env.DB.prepare('UPDATE users SET password_hash=?, updated_at=CURRENT_TIMESTAMP WHERE id=?')
    .bind(newHash, session.user_id).run()

  // Invalidate all other sessions
  await c.env.DB.prepare('DELETE FROM sessions WHERE user_id=? AND id!=?')
    .bind(session.user_id, sessionId).run()

  return c.json({ success: true })
})

export default auth
