export function reserveStock(sku, quantity) {
	return { sku, quantity, reserved: true };
}
