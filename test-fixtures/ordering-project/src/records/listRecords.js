export const PAGE_SIZE = 50;

/** Returns one page of stored records (FR-040, FR-041). */
export function listRecords(records) {
	const ordered = [...records].sort((a, b) => a.createdAt - b.createdAt);
	return ordered.slice(0, PAGE_SIZE);
}
