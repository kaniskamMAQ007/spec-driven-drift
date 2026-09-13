import { defineConfig } from '@vscode/test-cli';

// Only the integration tests run inside VS Code; core tests run with `npm run test:core`.
export default defineConfig({
	files: 'out/test/*.test.js',
	// Activating the extension host on a cold start can exceed mocha's 2s default.
	mocha: {
		timeout: 30000
	}
});
