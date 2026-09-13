import { clearSession } from './session';

/** Ends the session for a signed-in user and clears the stored token. */
export function logout(sessionToken) {
	clearSession(sessionToken);
}
