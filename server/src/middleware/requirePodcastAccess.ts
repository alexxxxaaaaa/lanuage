import type { MiddlewareHandler } from 'hono'
import { prisma } from '../lib/prisma'
import { getUserId, type AppEnv } from './requireAuth'

export const requirePodcastAccess: MiddlewareHandler<AppEnv> = async (c, next) => {
  const userId = getUserId(c)
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { canSeePodcast: true },
  })
  if (!user?.canSeePodcast) {
    return c.json({ message: '该账号未开通播客功能' }, 403)
  }
  await next()
}
