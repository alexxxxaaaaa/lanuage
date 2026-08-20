import { jwtVerify, SignJWT } from 'jose'
import { prisma } from '../lib/prisma'
import { getEnv } from '../lib/env'
import { AppError } from '../errors/AppError'
import { normalizeUsername } from '../lib/credentials'
import { hashPassword, verifyDummyPassword, verifyPassword } from '../lib/password'
import { checkThrottle, clearFailures, recordFailure } from './loginThrottle'

const TOKEN_TTL_SECONDS = 60 * 60 * 24 * 30 // 30 days
const JWT_ALG = 'HS256'
const JWT_ISSUER = 'word-sprint'
/** 低于这个长度的 secret 等于没加密，但线上真配短了也不该整站 500 —— 只出声。 */
const MIN_SECRET_LENGTH = 32

let warnedWeakSecret = false

function getJwtSecret(): Uint8Array {
  const secret = getEnv('JWT_SECRET')?.trim()
  if (!secret) {
    throw new AppError('JWT_SECRET is not configured', 500)
  }
  if (secret.length < MIN_SECRET_LENGTH && !warnedWeakSecret) {
    warnedWeakSecret = true
    console.warn(
      `JWT_SECRET is only ${secret.length} chars — generate a real one with \`openssl rand -hex 32\``,
    )
  }
  return new TextEncoder().encode(secret)
}

/**
 * ADMIN_USERNAMES 解析结果按原始字符串缓存。Workers 的 isolate 跨请求复用模块
 * 作用域，env 又不会中途变，所以实际只在冷启动时 split 一次。
 */
let adminCache: { raw: string; set: Set<string> } | null = null

/** 谁算管理员的唯一判据，requireAdmin 也走这里。 */
export function isUserAdmin(username: string): boolean {
  const raw = getEnv('ADMIN_USERNAMES') ?? ''
  if (adminCache?.raw !== raw) {
    adminCache = {
      raw,
      set: new Set(
        raw
          .split(',')
          .map((s) => s.trim().toLowerCase())
          .filter(Boolean),
      ),
    }
  }
  return adminCache.set.size > 0 && adminCache.set.has(username.toLowerCase())
}

type UserRow = { id: string; username: string; tokenVersion: number }

/** 出口的用户形状 —— passwordHash 不进这里，也就不会被顺手 JSON 出去。 */
function toPublicUser(user: { id: string; username: string }) {
  return { id: user.id, username: user.username, isAdmin: isUserAdmin(user.username) }
}

async function signTokenForUser(user: UserRow) {
  return new SignJWT({ username: user.username, tv: user.tokenVersion })
    .setProtectedHeader({ alg: JWT_ALG })
    .setIssuer(JWT_ISSUER)
    .setSubject(user.id)
    .setIssuedAt()
    .setExpirationTime(`${TOKEN_TTL_SECONDS}s`)
    .sign(getJwtSecret())
}

/**
 * 注册入口已经下线：建号只走管理后台（POST /api/admin/users → adminService）。
 * 公开的 /api/auth/register 前端从来没调过，留着等于把「谁都能建号并烧 AI 额度」
 * 挂在公网上。
 */
export async function login(
  rawUsername: string,
  password: string,
  throttleKey: string | null,
) {
  const throttle = await checkThrottle(throttleKey)

  const username = normalizeUsername(rawUsername)
  if (!username || !password) {
    throw new AppError('请输入用户名和密码', 400)
  }

  const user = await prisma.user.findUnique({
    where: { username },
    select: { id: true, username: true, tokenVersion: true, passwordHash: true },
  })

  if (!user) {
    // 跑一次假验证再返回。省掉它的话「查无此人」是立即返回而「密码错」要等一次
    // KDF，光看响应时间就能把用户名枚举干净。
    await verifyDummyPassword(password)
    await recordFailure(throttle)
    throw new AppError('用户名或密码错误', 401)
  }

  const { ok, needsRehash } = await verifyPassword(password, user.passwordHash)
  if (!ok) {
    await recordFailure(throttle)
    throw new AppError('用户名或密码错误', 401)
  }

  if (needsRehash) {
    // 老的 bcrypt 行（或旧迭代数的 PBKDF2）就地换成当前参数。只会发生一次。
    await prisma.user.update({
      where: { id: user.id },
      data: { passwordHash: await hashPassword(password) },
    })
  }

  await clearFailures(throttle)

  return {
    token: await signTokenForUser(user),
    user: toPublicUser(user),
  }
}

export async function getUserById(id: string) {
  const user = await prisma.user.findUnique({
    where: { id },
    select: { id: true, username: true, createdAt: true },
  })
  if (!user) {
    throw new AppError('用户不存在', 404)
  }
  return { ...toPublicUser(user), createdAt: user.createdAt }
}

export type TokenPayload = { sub: string; username: string; tokenVersion: number }

export async function verifyToken(token: string): Promise<TokenPayload> {
  try {
    // 显式钉死算法和签发方：不写 algorithms 就等于让 token 自己声明用什么验，
    // issuer 则让别处签的同密钥 token 进不来。
    const { payload } = await jwtVerify(token, getJwtSecret(), {
      algorithms: [JWT_ALG],
      issuer: JWT_ISSUER,
    })
    const sub = typeof payload.sub === 'string' ? payload.sub : ''
    const username = typeof payload.username === 'string' ? payload.username : ''
    const tokenVersion = typeof payload.tv === 'number' ? payload.tv : NaN
    if (!sub || !Number.isInteger(tokenVersion)) {
      throw new AppError('无效的登录凭证', 401)
    }
    return { sub, username, tokenVersion }
  } catch (error) {
    if (error instanceof AppError) throw error
    throw new AppError('登录已过期，请重新登录', 401)
  }
}
