import 'dotenv/config'
import { webcrypto } from 'node:crypto'
if (!globalThis.crypto) {
  ;(globalThis as { crypto: Crypto }).crypto = webcrypto as unknown as Crypto
}
import { serve } from '@hono/node-server'
import { createApp } from './app'

const app = createApp()

const port = Number(process.env.PORT) || 3000

serve({ fetch: app.fetch, port }, (info) => {
  console.log(`Server running at http://localhost:${info.port}`)
})
