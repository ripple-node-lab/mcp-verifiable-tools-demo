export class JsonRpcProtocolError extends Error {
  constructor(readonly code: number, message: string) {
    super(message);
    this.name = "JsonRpcProtocolError";
  }
}
