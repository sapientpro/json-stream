/** @type {import('ts-jest').JestConfigWithTsJest} **/
module.exports = {
    testMatch: ['<rootDir>/tests/**/*.test.ts'],
    testEnvironment: 'node',
    transform: {
        '^.+.tsx?$': ['ts-jest', {}],
    },
    //Source uses extensioned relative imports so the ESM build resolves; strip
    //the extension for ts-jest, which loads the .ts files directly.
    moduleNameMapper: {
        '^(\\.{1,2}/.*)\\.js$': '$1',
    },
};
