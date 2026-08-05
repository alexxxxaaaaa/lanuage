/**
 * 用户名 / 密码的格式规则。建号的入口只剩管理后台一处（authService 负责验，
 * adminService 负责建），两边共用同一份规则，免得后台放进来的用户名前台登不上。
 */
import { AppError } from '../errors/AppError'

const MIN_USERNAME_LENGTH = 2
const MAX_USERNAME_LENGTH = 32
const MIN_PASSWORD_LENGTH = 6
/**
 * 上限存在的理由不是安全而是成本：PBKDF2 的耗时和密码长度无关，但 HMAC 的第一次
 * 分组要把整个密码摘要一遍，几 MB 的「密码」等于让任何人白嫖 Worker CPU。
 */
const MAX_PASSWORD_LENGTH = 128

const USERNAME_RE = /^[a-zA-Z0-9_\-.]+$/

/** 用户名一律按小写存、按小写查 —— 库里的唯一约束是区分大小写的。 */
export function normalizeUsername(input?: string): string {
  return (input ?? '').trim().toLowerCase()
}

/** 建号时校验；登录时不用，登录只认「用户名或密码错误」这一种回答。 */
export function assertCredentialFormat(username: string, password: string) {
  if (username.length < MIN_USERNAME_LENGTH || username.length > MAX_USERNAME_LENGTH) {
    throw new AppError(`用户名需为 ${MIN_USERNAME_LENGTH}-${MAX_USERNAME_LENGTH} 个字符`, 400)
  }
  if (!USERNAME_RE.test(username)) {
    throw new AppError('用户名只能包含字母、数字、下划线、点或连字符', 400)
  }
  assertPasswordFormat(password)
}

/** 单独校验密码 —— 管理后台重置密码时用，那时用户名不变。 */
export function assertPasswordFormat(password: string) {
  if (password.length < MIN_PASSWORD_LENGTH) {
    throw new AppError(`密码至少 ${MIN_PASSWORD_LENGTH} 个字符`, 400)
  }
  if (password.length > MAX_PASSWORD_LENGTH) {
    throw new AppError(`密码最多 ${MAX_PASSWORD_LENGTH} 个字符`, 400)
  }
}
