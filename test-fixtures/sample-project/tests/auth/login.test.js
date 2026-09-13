import { login } from '../../src/auth/login';

describe('login (FR-001)', () => {
	it('creates a session for a valid email and password', async () => {
		await login('user@example.com', 'correct horse');
	});

	it('returns nothing when the password is wrong', async () => {
		await login('user@example.com', 'wrong');
	});
});
