import "@dotenvx/dotenvx/config";
import { createJsWithTsEsmPreset, type JestConfigWithTsJest } from 'ts-jest'

// Top-level await in test files (required by jest.unstable_mockModule + dynamic
// import pattern) needs module/target settings that support TLA. The project
// tsconfig uses ESNext/Bundler which ts-jest doesn't propagate correctly, so we
// override the two relevant options here.
const esmPreset = createJsWithTsEsmPreset({
  tsconfig: {
    module: "ESNext",
    target: "ES2022",
  },
})


const shared: JestConfigWithTsJest = {
  ...esmPreset,
  moduleNameMapper: {
    '^loadbench-kit/(.*).js$': '<rootDir>/src/$1',
  },
  transformIgnorePatterns: ['node_modules'],
  testPathIgnorePatterns: [ ".scratch", "dist", "examples", "node_modules", "src"],
};

const config: JestConfigWithTsJest = {
  bail: true,
  collectCoverage: true,
  projects: [
    {
      ...shared,
      displayName: 'unit',
      testMatch: ['<rootDir>/test/unit/**/*.test.ts'],
    },
    {
      ...shared,
      displayName: 'integration',
      testMatch: ['<rootDir>/test/integration/**/*.test.ts'],
    }
  ],
};

export default config;
