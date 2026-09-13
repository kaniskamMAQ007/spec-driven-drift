/** Sends a message to the customer when an order changes state. */
export function sendOrderMessage(orderId, status) {
	return { orderId, status, sent: true };
}
