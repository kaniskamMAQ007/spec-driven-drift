import { createSession, findUserByEmail, verifyPassword } from './session';

/**
 * Authenticates a registered user with an email address and password (FR-001).
 */
export async function login(email, password) {
	const user = await findUserByEmail(email);
	if (!user || !verifyPassword(user, password)) {
		return undefined;
	}
	return createSession(user);
}
