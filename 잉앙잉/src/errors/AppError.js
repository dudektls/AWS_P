export class AppError extends Error {
  constructor(status, code, publicMessage, options = {}) {
    super(publicMessage, options);
    this.name = "AppError";
    this.status = status;
    this.code = code;
    this.publicMessage = publicMessage;
  }
}
