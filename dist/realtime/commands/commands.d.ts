import { Topic } from '../../topic';
import { MQTToTClient } from '../../mqttot';
import * as mqtts_1 from '../../mqtt-shim';
export declare class Commands {
    private client;
    constructor(client: MQTToTClient);
    private publishToTopic;
    updateSubscriptions(options: {
        topic: Topic;
        data: {
            sub?: string[];
            unsub?: string[];
        } | any;
    }): Promise<MqttMessageOutgoing>;
}
