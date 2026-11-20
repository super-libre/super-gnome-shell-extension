import { defineConfig } from 'vitest/config';

// The tests run under Node, so they reach src/core alone: src/shell and the
// preferences import GNOME's modules, which only GJS has. Coverage measures
// what they can reach.
export default defineConfig({
    test: {
        coverage: {
            provider: 'v8',
            include: ['src/core/**/*.ts'],
            reporter: ['text-summary', 'html', 'json-summary', 'lcovonly'],
            reportsDirectory: 'coverage',
        },
    },
});
