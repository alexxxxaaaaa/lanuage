// Icon generation is a one-off task, so @vite-pwa/assets-generator is NOT a
// installed dependency — it pulled in an old sharp (0.33.x) with libvips CVEs
// and sat in the tree year-round for something we run once. The generated
// icons live in public/. To regenerate after changing favicon.svg:
//
//   npx @vite-pwa/assets-generator@latest
//
import { defineConfig, minimal2023Preset } from '@vite-pwa/assets-generator/config'

export default defineConfig({
  preset: {
    ...minimal2023Preset,
    maskable: {
      ...minimal2023Preset.maskable,
      padding: 0.18,
      resizeOptions: { background: '#ffffff' },
    },
  },
  images: ['public/favicon.svg'],
})
