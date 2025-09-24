export default {
  preset: 'ts-jest',
  testEnvironment: 'node',
  extensionsToTreatAsEsm: ['.ts'],
  transform: {
    '^.+\\.tsx?$': ['ts-jest', {
      useESM: true
    }]
  },
  testMatch: [
    '**/tests/**/*.test.ts',
    '**/src/**/__tests__/**/*.test.ts'
  ],
  collectCoverageFrom: [
    'src/**/*.ts',
    '!src/**/*.d.ts'
  ],
  globalSetup: '<rootDir>/src/utils/test-setup.ts',
  globalTeardown: '<rootDir>/src/utils/test-teardown.ts'
};