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
