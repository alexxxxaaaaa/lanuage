/**
 * 密码哈希。走 Web Crypto 的 PBKDF2-HMAC-SHA256，Node 和 Workers 上是同一份
 * 实现，也是 Workers 上唯一能用的原生 KDF —— bcrypt / scrypt / Argon2 在
 * workerd 里都只能靠纯 JS 或 WASM 跑。
 *
 * 为什么从 bcryptjs 换过来：bcryptjs 是纯 JS 的 bcrypt，cost=10 实测 111ms 全
 * 是 JS 执行时间，在 Workers 上顶着 CPU 限额，是全站最贵的一次请求。PBKDF2 走
 * 的是原生实现，不占 JS 线程。
 *
 * 迭代数被平台钉死在 100k：workerd 的 Web Crypto 对 PBKDF2 有硬上限，超过就抛
 * `NotSupportedError: iteration counts above 100000 are not supported`。这里曾按
 * OWASP 对 PBKDF2-SHA256 的推荐值填 600k，结果是线上每次登录必 500 —— 本地
 * `npm run dev` 和测试都跑在 Node 上，Node 没有这个上限，所以测不出来。改这个
 * 常量前先确认 workerd 是否放宽了限制，别只在 Node 上验。
 *
 * 100k 低于 OWASP 的推荐值，这是平台天花板下的既定事实，不是选择。要补回强度得
 * 换构造（例如链式多轮，或迁到 WASM 的 Argon2），届时靠 needsRehash 就能在各自
 * 下次登录时无缝换掉，不需要迁移 SQL —— 存储格式本来就是自描述的。
 *
 * 存储格式是自描述的：
 *   pbkdf2$sha256$<迭代数>$<salt base64>$<hash base64>
 * 迭代数写在串里，以后调高不影响老行 —— 老行按它自己记的迭代数验，验过之后
 * needsRehash 会置位，调用方顺手重写成新参数。bcrypt 老行（`$2a$…`）走同一个
 * 出口，因此换算法不需要任何数据迁移。
 */
import bcrypt from 'bcryptjs'

/** workerd 的上限，不是调优出来的值 —— 见文件头。 */
const PBKDF2_ITERATIONS = 100_000
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
 *
 * 串里的迭代数必须跟 PBKDF2_ITERATIONS 一起改：verifyPassword 是从串里解析迭代
 * 数的，不看常量。忘了改这行，「用户不存在」这条路径会继续用老迭代数跑，超上限
 * 时整条路径 500 —— 而这恰好是登录最常走的分支之一。
 */
const DUMMY_HASH =
  'pbkdf2$sha256$100000$s10hMMKAE36L70RFBQmxKw==$BZk4HZ2XR95gxLQaeTeBgMRG+kMoc8iT9XsXnKgrN8A='

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
