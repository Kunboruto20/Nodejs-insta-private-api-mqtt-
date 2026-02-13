"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.addTransactionCapability = void 0;
const async_hooks_1 = require("async_hooks");
const async_mutex_1 = require("async-mutex");
const p_queue_1 = __importDefault(require("p-queue"));
// Logger stub if not provided
const defaultLogger = {
    trace: (obj, msg) => console.log('[TRACE]', msg, obj),
    debug: (obj, msg) => console.log('[DEBUG]', msg, obj),
    info: (obj, msg) => console.log('[INFO]', msg, obj),
    warn: (obj, msg) => console.warn('[WARN]', msg, obj),
    error: (obj, msg) => console.error('[ERROR]', msg, obj),
};
/**
 * Adds transaction capability and sequential processing to the Instagram Realtime Client
 * ensuring messages are sent in order (e.g. "Salut" before "Ce faci").
 *
 * @param client The RealtimeClient instance from nodejs-insta-private-api-mqtt
 * @param logger Optional logger
 * @returns The wrapped client with transaction capabilities
 */
const addTransactionCapability = (client, logger = defaultLogger) => {
    const txStorage = new async_hooks_1.AsyncLocalStorage();
    // Global queue for all direct thread operations to ensure sequence
    // concurrency: 1 is CRITICAL for ensuring messages arrive in order "Salut" -> "Ce faci" -> "Unde esti"
    const globalQueue = new p_queue_1.default({ concurrency: 1 });
    // Per-thread queues if we want parallelism across different threads but serial within a thread
    const threadQueues = new Map();
    function getThreadQueue(threadId) {
        if (!threadQueues.has(threadId)) {
            threadQueues.set(threadId, new p_queue_1.default({ concurrency: 1 }));
        }
        return threadQueues.get(threadId);
    }
    // Mutex for critical sections
    const clientMutex = new async_mutex_1.Mutex();
    // Helper to check if we are in a transaction
    function isInTransaction() {
        return !!txStorage.getStore();
    }
    // Wrap the directCommands (EnhancedDirectCommands)
    if (client.directCommands) {
        const originalSendText = client.directCommands.sendText.bind(client.directCommands);
        client.directCommands.sendText = async (...args) => {
            const firstArg = args[0];
            const threadId = (firstArg && typeof firstArg === 'object') ? firstArg.threadId : firstArg;
            const queue = typeof threadId === 'string' ? getThreadQueue(threadId) : globalQueue;
            return queue.add(async () => {
                logger.trace({ threadId }, 'Queueing message send to ensure order');
                return originalSendText(...args);
            });
        };
        const methodsToWrap = ['sendLink', 'sendPhoto', 'sendVideo', 'sendVoice', 'sendLike', 'sendPost'];
        methodsToWrap.forEach(method => {
            if (client.directCommands[method]) {
                const originalMethod = client.directCommands[method].bind(client.directCommands);
                client.directCommands[method] = async (...args) => {
                    const firstArg = args[0];
                    const threadId = (firstArg && typeof firstArg === 'object') ? firstArg.threadId : firstArg;
                    const queue = typeof threadId === 'string' ? getThreadQueue(threadId) : globalQueue;
                    return queue.add(async () => {
                        logger.trace({ method, threadId }, 'Queueing direct command');
                        return originalMethod(...args);
                    });
                };
            }
        });
    }
    // Also wrap the underlying publish method if needed for raw MQTT operations
    if (client.mqtt && client.mqtt.publish) {
        const originalPublish = client.mqtt.publish.bind(client.mqtt);
        client.mqtt.publish = async (...args) => {
            const [topic, payload] = args;
            // Determine if this is a direct message related topic
            const isDirectRelated = topic.includes('direct') || topic.includes('send_message');
            if (isDirectRelated) {
                return globalQueue.add(async () => {
                    logger.trace({ topic }, 'Queueing MQTT publish');
                    return originalPublish(...args);
                });
            }
            return originalPublish(...args);
        };
    }
    /**
     * Transaction wrapper similar to the Baileys one.
     * Allows grouping multiple operations into a single atomic-like unit (logically).
     */
    const transaction = async (work) => {
        const existing = txStorage.getStore();
        if (existing) {
            return work();
        }
        // We use the mutex to lock the client during the transaction
        return clientMutex.runExclusive(async () => {
            const ctx = {
                id: Date.now(),
                timestamp: new Date()
            };
            return txStorage.run(ctx, async () => {
                try {
                    logger.trace('Starting transaction');
                    const result = await work();
                    logger.trace('Transaction completed');
                    return result;
                }
                catch (error) {
                    logger.error({ error }, 'Transaction failed');
                    throw error;
                }
            });
        });
    };
    // Expose the transaction method on the client
    client.transaction = transaction;
    client.isInTransaction = isInTransaction;
    return {
        client,
        transaction,
        isInTransaction
    };
};
exports.addTransactionCapability = addTransactionCapability;
exports.default = exports.addTransactionCapability;
