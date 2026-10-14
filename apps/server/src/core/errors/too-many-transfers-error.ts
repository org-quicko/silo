/** Every prepared-transfer slot is taken (D109): HTTP 429, code `too_many_transfers`. */
export class TooManyTransfersError extends Error {
  constructor(open: number) {
    super(
      `${open} transfers are already prepared or running on this server, the most it holds; ` +
        `apply or cancel one, or wait for one to expire`
    );
    this.name = "TooManyTransfersError";
  }
}
