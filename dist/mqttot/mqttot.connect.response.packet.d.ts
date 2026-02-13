/// <reference types="node" />
import * as mqtts_1 from '../mqtt-shim';
export declare class MQTToTConnectResponsePacket extends ConnectResponsePacket {
    readonly payload: Buffer;
    constructor(ackFlags: number, returnCode: ConnectReturnCode, payload: Buffer);
}
export declare function readConnectResponsePacket(stream: PacketStream, remaining: number): MQTToTConnectResponsePacket;
