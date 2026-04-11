import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)

/** @type {import('eslint').Linter.Config[]} */
const next = require('eslint-config-next')

/** Next 16 + React 19: eslint-plugin-react-hooks adds strict rules that flag common client-only patterns. */
const eslintConfig = [
  ...next,
  {
    name: 'fserp/next16-pragmatic',
    rules: {
      // Valid in client components (hydration, localStorage, etc.)
      'react-hooks/set-state-in-effect': 'off',
      // React Compiler hints — manual useMemo is intentional in places
      'react-hooks/preserve-manual-memoization': 'off',
      // Prefer &quot; in copy later; not worth blocking builds
      'react/no-unescaped-entities': 'warn',
    },
  },
]

export default eslintConfig
