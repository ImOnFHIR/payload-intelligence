// SPDX-License-Identifier: Apache-2.0

import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    exclude: ['e2e/**', '**/node_modules/**', '**/dist/**', '**/dist-types/**'],
  },
})
