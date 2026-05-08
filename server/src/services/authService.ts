import bcrypt from 'bcryptjs'
import { jwtVerify, SignJWT } from 'jose'
import { prisma } from '../lib/prisma'
import { getEnv } from '../lib/env'
import { AppError } from '../errors/AppError'

const TOKEN_TTL_SECONDS = 60 * 60 * 24 * 30 // 30 days
const MIN_USERNAME_LENGTH = 2
const MIN_PASSWORD_LENGTH = 6

function getJwtSecret(): Uint8Array {
  const secret = getEnv('JWT_SECRET')?.trim()
  if (!secret) {
    throw new AppError('JWT_SECRET is not configured', 500)
  }
  return new TextEncoder().encode(secret)
}

function normalizeUsername(input?: string) {
  return (input ?? '').trim().toLowerCase()
}

function assertCredentialFormat(username: string, password: string) {
  if (username.length < MIN_USERNAME_LENGTH) {
    throw new AppError('用户名至少 2 个字符', 400)
  }
  if (!/^[a-zA-Z0-9_\-.]+$/.test(username)) {
    throw new AppError('用户名只能包含字母、数字、下划线、点或连字符', 400)
  }
  if (password.length < MIN_PASSWORD_LENGTH) {
    throw new AppError('密码至少 6 个字符', 400)
  }
}

async function signTokenForUser(user: { id: string; username: string }) {
  return new SignJWT({ username: user.username })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(user.id)
    .setIssuedAt()
    .setExpirationTime(`${TOKEN_TTL_SECONDS}s`)
    .sign(getJwtSecret())
}

export async function register(rawUsername: string, password: string) {
  const username = normalizeUsername(rawUsername)
  assertCredentialFormat(username, password)

  const existing = await prisma.user.findUnique({ where: { username } })
  if (existing) {
    throw new AppError('用户名已被占用', 409)
  }

  const passwordHash = await bcrypt.hash(password, 10)
  const user = await prisma.user.create({
    data: {
      username,
      passwordHash,
    },
  })

  return {
    token: await signTokenForUser(user),
    user: { id: user.id, username: user.username },
  }
}

export async function login(rawUsername: string, password: string) {
  const username = normalizeUsername(rawUsername)
  if (!username || !password) {
    throw new AppError('请输入用户名和密码', 400)
  }

  const user = await prisma.user.findUnique({ where: { username } })
  if (!user) {
    throw new AppError('用户名或密码错误', 401)
  }

  const ok = await bcrypt.compare(password, user.passwordHash)
  if (!ok) {
    throw new AppError('用户名或密码错误', 401)
  }

  return {
    token: await signTokenForUser(user),
    user: { id: user.id, username: user.username },
  }
}

export async function getUserById(id: string) {
  const user = await prisma.user.findUnique({ where: { id } })
  if (!user) {
    throw new AppError('用户不存在', 404)
  }
  return { id: user.id, username: user.username, createdAt: user.createdAt }
}

export async function verifyToken(token: string): Promise<{ sub: string; username: string }> {
  try {
    const { payload } = await jwtVerify(token, getJwtSecret())
    const sub = typeof payload.sub === 'string' ? payload.sub : ''
    const username = typeof payload.username === 'string' ? payload.username : ''
    if (!sub) {
      throw new AppError('无效的登录凭证', 401)
    }
    return { sub, username }
  } catch (error) {
    if (error instanceof AppError) throw error
    throw new AppError('登录已过期，请重新登录', 401)
  }
}
