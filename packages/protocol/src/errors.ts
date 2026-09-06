import { JsonValue } from "./types.js";

export class JsonRpcProtocolError extends Error {
  constructor(readonly code: number, message: string, readonly data?: JsonValue) {
    super(message);
    this.name = "JsonRpcProtocolError";
  }
}
