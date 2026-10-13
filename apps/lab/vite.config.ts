// SPDX-License-Identifier: Apache-2.0

import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'node:path'

export default defineConfig({
  plugins: [react()],
  publicDir: resolve(import.meta.dirname, '../../examples/synthetic'),
  build: { outDir: 'dist', emptyOutDir: true, sourcemap: false },
})
