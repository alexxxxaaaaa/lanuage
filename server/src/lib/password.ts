/**
 * 密码哈希。走 Web Crypto 的 PBKDF2-HMAC-SHA256，Node 和 Workers 上是同一份
 * 实现，也是 Workers 上唯一能用的原生 KDF —— bcrypt / scrypt / Argon2 在
 * workerd 里都只能靠纯 JS 或 WASM 跑。
 *
 * 为什么从 bcryptjs 换过来：bcryptjs 是纯 JS 的 bcrypt，cost=10 实测 111ms 全
 * 是 JS 执行时间，在 Workers 上顶着 CPU 限额，是全站最贵的一次请求。PBKDF2 走
 * 的是原生实现，600k 迭代实测 65ms，更快而且不占 JS 线程。
 *
 * 迭代数取 OWASP 对 PBKDF2-SHA256 的推荐值 600k。PBKDF2 对 GPU 爆破的抵抗力
 * 本就不如 bcrypt（没有 bcrypt 那 4KB 工作内存拖慢显卡），所以这里不省迭代。
 *
 * 存储格式是自描述的：
 *   pbkdf2$sha256$<迭代数>$<salt base64>$<hash base64>
 * 迭代数写在串里，以后调高不影响老行 —— 老行按它自己记的迭代数验，验过之后
 * needsRehash 会置位，调用方顺手重写成新参数。bcrypt 老行（`$2a$…`）走同一个
 * 出口，因此换算法不需要任何数据迁移。
 */
import bcrypt from 'bcryptjs'

const PBKDF2_ITERATIONS = 600_000
const PBKDF2_HASH = 'SHA-256'
const SALT_BYTES = 16
const KEY_BITS = 256

const PREFIX = 'pbkdf2$sha256$'
const BCRYPT_RE = /^\$2[aby]\$/

/**
 * 用户名不存在时拿来跑一次假验证的哈希，密码是一段随机串，永远不会有人猜中。
 *
 * 没有它的话，「用户不存在」是 0ms 返回而「密码错」要等一次 KDF，响应时间差一个
 * 数量级，用户名就成了可枚举的。
 */
const DUMMY_HASH =
  'pbkdf2$sha256$600000$gP/Yq05LVz41xK7XIsDxwg==$JtbmB19SBzUFftgOwSQrqHFzLS71mo623++ojVmPaXk='

function toBase64(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary)
}

function fromBase64(value: string): Uint8Array {
  const binary = atob(value)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i)
  return bytes
}

/** 逐字节异或累加，比较耗时与内容无关 —— 别用 === 比哈希。 */
function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i += 1) diff |= a[i] ^ b[i]
  return diff === 0
}

async function derive(
  password: string,
  salt: Uint8Array,
  iterations: number,
): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    'PBKDF2',
    false,
    ['deriveBits'],
  )
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: PBKDF2_HASH, salt: salt as BufferSource, iterations },
    key,
    KEY_BITS,
  )
  return new Uint8Array(bits)
}

export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES))
  const hash = await derive(password, salt, PBKDF2_ITERATIONS)
  return `${PREFIX}${PBKDF2_ITERATIONS}$${toBase64(salt)}$${toBase64(hash)}`
}

export type VerifyResult = {
  ok: boolean
  /** 密码对，但存的还是老格式 / 老参数 —— 调用方该就地重写成新哈希。 */
  needsRehash: boolean
}

export async function verifyPassword(
  password: string,
  stored: string,
): Promise<VerifyResult> {
  if (BCRYPT_RE.test(stored)) {
    // 迁移期的老行。验过就顺手换成 PBKDF2，全部用户登录过一轮后 bcryptjs 依赖
    // 就能从 package.json 里删掉了。
    const ok = await bcrypt.compare(password, stored)
    return { ok, needsRehash: ok }
  }

  if (!stored.startsWith(PREFIX)) {
    return { ok: false, needsRehash: false }
  }

  const [iterationsRaw, saltRaw, hashRaw] = stored.slice(PREFIX.length).split('$')
  const iterations = Number(iterationsRaw)
  if (!Number.isInteger(iterations) || iterations <= 0 || !saltRaw || !hashRaw) {
    return { ok: false, needsRehash: false }
  }

  const expected = fromBase64(hashRaw)
  const actual = await derive(password, fromBase64(saltRaw), iterations)
  const ok = timingSafeEqual(actual, expected)
  return { ok, needsRehash: ok && iterations !== PBKDF2_ITERATIONS }
}

/**
 * 用户名不存在时调它，把「查无此人」的耗时垫到和「密码错」一个量级。
 * 返回值恒为 false，调用方不需要看。
 */
export async function verifyDummyPassword(password: string): Promise<void> {
  await verifyPassword(password, DUMMY_HASH)
}
