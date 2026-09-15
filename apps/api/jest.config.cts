/* eslint-disable */
const { readFileSync } = require('fs');

// Reading the SWC compilation config for the spec files
const swcJestConfig = JSON.parse(
  readFileSync(`${__dirname}/.spec.swcrc`, 'utf-8'),
);

// Disable .swcrc look-up by SWC core because we're passing in swcJestConfig ourselves
swcJestConfig.swcrc = false;

module.exports = {
  displayName: 'api',
  preset: '../../jest.preset.js',
  testEnvironment: 'node',
  transform: {
    '^.+\\.[tj]s$': ['@swc/jest', swcJestConfig],
  },
  moduleFileExtensions: ['ts', 'js', 'html'],
  // Mirrors the `src/*` alias from tsconfig.app.json and webpack.config.js
  moduleNameMapper: {
    '^src/(.*)$': '<rootDir>/src/$1',
  },
  /*
    `node_modules` is left untransformed by default, and a handful of our
    dependencies ship ESM only — `https-proxy-agent` and its `agent-base` reach
    the graph through `ProxyManagerService`, so importing anything that touches
    the bank-scraper barrel died on `Cannot use import statement outside a
    module`.

    Specs were working around it one at a time with
    `jest.mock('src/modules/bank-scraper')`, which is a per-file plaster over a
    config gap — and it made a real dependency-injection test impossible, since
    stubbing the module is exactly what such a test must not do.
  */
  transformIgnorePatterns: [
    '/node_modules/(?!(https-proxy-agent|agent-base|proxy-agent-negotiate)/)',
  ],
  coverageDirectory: 'test-output/jest/coverage',
};
