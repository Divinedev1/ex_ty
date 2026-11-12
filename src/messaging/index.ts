import { startBroker } from "./broker.js";
import { registerAuditConsumer } from "./audit.consumer.js";

export const startMessaging = async (): Promise<void> => {
    registerAuditConsumer();
    await startBroker();
};