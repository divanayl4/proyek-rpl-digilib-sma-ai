import type { Config } from "jest";

const config: Config = {
  preset: "ts-jest",
  testEnvironment: "node",
  moduleNameMapper: {
    "^@/(.*)$": "<rootDir>/src/$1",
  },
  testMatch: ["**/__tests__/**/*.test.ts", "**/__tests__/**/*.test.tsx"],
  transform: {
    "^.+\\.(ts|tsx)$": [
      "ts-jest",
      {
        tsconfig: {
          jsx: "react-jsx",
        },
      },
    ],
  },
  // Exclude Next.js build output and the pre-migration backup snapshot.
  modulePathIgnorePatterns: ["<rootDir>/.next/"],
  testPathIgnorePatterns: [
    "/node_modules/",
    "/.next/",
    "/backup-telegram-migration-",
  ],
  // Setup files (add here if needed)
  // setupFilesAfterFramework: [],
  collectCoverageFrom: [
    "src/lib/**/*.ts",
    "src/app/api/**/*.ts",
    "!src/**/*.d.ts",
    "!src/**/index.ts",
  ],
};

export default config;
