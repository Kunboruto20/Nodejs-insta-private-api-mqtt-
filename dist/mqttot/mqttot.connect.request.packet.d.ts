/// <reference types="node" />
import * as mqtts_1 from '../mqtt-shim';
export interface MQTToTConnectPacketOptions {
    keepAlive: number;
    payload: Buffer;
}
export declare function writeConnectRequestPacket(stream: PacketStream, options: MQTToTConnectPacketOptions): PacketWriteResult;
