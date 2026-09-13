/** Builds the monthly revenue report that the finance team reads. */
export function generateMonthlyReport(month) {
	return { month, rows: [] };
}

export function formatReportRow(row) {
	return `${row.label}: ${row.amount}`;
}
