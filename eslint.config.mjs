import nx from '@nx/eslint-plugin'

export default [
  ...nx.configs['flat/base'],
  ...nx.configs['flat/typescript'],
  ...nx.configs['flat/javascript'],
  {
    ignores: ['**/dist', '**/out-tsc']
  },
  {
    files: ['**/*.ts', '**/*.tsx', '**/*.js', '**/*.jsx'],
    rules: {
      '@nx/enforce-module-boundaries': [
        'error',
        {
          enforceBuildableLibDependency: true,
          allow: ['^.*/eslint(\\.base)?\\.config\\.[cm]?[jt]s$'],
          depConstraints: [
            // Contracts are the shared source of truth and may never depend on an
            // app, so the dependency graph always points inward.
            {
              sourceTag: 'type:contracts',
              onlyDependOnLibsWithTags: ['type:contracts']
            },
            // An app consumes shared libs only — never another app.
            {
              sourceTag: 'type:app',
              onlyDependOnLibsWithTags: ['scope:shared']
            },
            // A shared UI library may reach the contracts and nothing else.
            // `@transacto/history-table` renders the terminal history for both
            // the extension and the admin panel, so it must know the wire
            // shapes — and must never learn anything about either app, or the
            // two would meet through it.
            {
              sourceTag: 'type:ui',
              onlyDependOnLibsWithTags: ['type:contracts']
            },
            // No coupling between the backend and either frontend.
            {
              sourceTag: 'scope:backend',
              onlyDependOnLibsWithTags: ['scope:shared', 'scope:backend']
            },
            {
              sourceTag: 'scope:extension',
              onlyDependOnLibsWithTags: ['scope:shared', 'scope:extension']
            },
            {
              sourceTag: 'scope:tma',
              onlyDependOnLibsWithTags: ['scope:shared', 'scope:tma']
            },
            {
              sourceTag: 'scope:admin',
              onlyDependOnLibsWithTags: ['scope:shared', 'scope:admin']
            }
          ]
        }
      ]
    }
  },
  {
    files: [
      '**/*.ts',
      '**/*.tsx',
      '**/*.cts',
      '**/*.mts',
      '**/*.js',
      '**/*.jsx',
      '**/*.cjs',
      '**/*.mjs'
    ],
    // Override or add rules here
    rules: {}
  }
]
