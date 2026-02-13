import { EventEmitter } from 'events';

export class PacketType {
  static Connect: number;
  static ConnAck: number;
  static Publish: number;
  static PubAck: number;
  static Subscribe: number;
  static SubAck: number;
  static Unsubscribe: number;
  static UnsubAck: number;
  static PingReq: number;
  static PingResp: number;
  static Disconnect: number;
}

export class ConnectResponsePacket {
  ackFlags: number;
  returnCode: number;
  payload?: Buffer;
  get isSuccess(): boolean;
  get errorName(): string | null;
  constructor(ackFlags: number, returnCode: number, payload?: Buffer);
}

export class IllegalStateError extends Error {}

export interface MqttMessage {
    topic: string;
    payload: Buffer;
    qosLevel?: number;
}

export interface MqttMessageOutgoing {
    topic: string;
    payload: Buffer;
    qosLevel?: number;
}

export interface PacketFlowFunc {
    (success: (packet: any) => void, error: (error: Error) => void): {
        start: () => any;
        accept: (packet: any) => boolean;
        next: (packet: any) => void;
    };
}

export class MqttClient extends EventEmitter {
  constructor(options: any);
  connect(options?: any): Promise<void>;
  publish(message: MqttMessageOutgoing): Promise<any>;
  subscribe(topic: string, qos?: number): Promise<void>;
  disconnect(): void;
  topicMap: Map<string, any>;
}

export class TlsTransport { constructor(options: any); }
export class SocksTlsTransport { constructor(options: any); }

export class PacketStream {
  constructor(buffer: Buffer);
  readByte(): number;
  readStringAsBuffer(): Buffer;
  readWord(): number;
}

export const DefaultPacketReadMap: any;
export const DefaultPacketWriteMap: any;
export function isConnAck(packet: any): boolean;

export interface ConnectRequestOptions {
    payload?: Buffer;
    keepAlive?: number;
    [key: string]: any;
}

export interface DefaultPacketReadResultMap {
    [key: number]: (stream: PacketStream, length: number) => any;
}

export interface DefaultPacketWriteOptions {
    [key: string]: any;
}

export interface PacketWriteResult {
    [key: string]: any;
}

export enum ConnectReturnCode {
    ACCEPTED = 0,
    UNACCEPTABLE_PROTOCOL_VERSION = 1,
    IDENTIFIER_REJECTED = 2,
    SERVER_UNAVAILABLE = 3,
    BAD_USERNAME_OR_PASSWORD = 4,
    NOT_AUTHORIZED = 5,
}
