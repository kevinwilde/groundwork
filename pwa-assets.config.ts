import { defineConfig, minimal2023Preset } from '@vite-pwa/assets-generator/config';

// Icons are generated from public/logo.svg at build time (and served in dev) by vite-plugin-pwa.
// Maskable and Apple icons get padding on the app's light ground so the plate isn't cropped.
const ground = '#edf0f4';

export default defineConfig({
  headLinkOptions: { preset: '2023' },
  preset: {
    ...minimal2023Preset,
    maskable: { ...minimal2023Preset.maskable, resizeOptions: { background: ground } },
    apple: { ...minimal2023Preset.apple, resizeOptions: { background: ground } },
  },
  images: ['public/logo.svg'],
});
