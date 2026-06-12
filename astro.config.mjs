// @ts-check
import { defineConfig } from 'astro/config';

import tailwindcss from '@tailwindcss/vite';

// https://astro.build/config
export default defineConfig({
  site: 'https://kim-iceride.ulasayyildiz2.workers.dev',
  vite: {
    plugins: [tailwindcss()]
  }
});