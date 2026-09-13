/**
 * Timestamp comparison.
 *
 * This was the original drift signal for this extension. It is now only a
 * fallback used when Git history is unavailable, because file times say nothing
 * about whether behaviour actually changed.
 */

export interface TimestampInput {
	relPath: string;
	mtimeMs: number;
}

export interface TimestampComparison {
	/** True when an implementation file is newer than every specification file. */
	changedAfterSpec: boolean;
	newestImplementation?: TimestampInput;
	newestSpecTime: number;
}

export function compareTimestamps(
	specFiles: TimestampInput[],
	implementationFiles: TimestampInput[]
): TimestampComparison {
	const newestSpecTime = specFiles.reduce((newest, file) => Math.max(newest, file.mtimeMs), 0);
	let newestImplementation: TimestampInput | undefined;

	for (const file of implementationFiles) {
		if (!newestImplementation || file.mtimeMs > newestImplementation.mtimeMs) {
			newestImplementation = file;
		}
	}

	return {
		changedAfterSpec:
			newestSpecTime > 0 &&
			newestImplementation !== undefined &&
			newestImplementation.mtimeMs > newestSpecTime,
		newestImplementation,
		newestSpecTime
	};
}

