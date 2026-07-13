export class AdminRedirectException extends Error {
  constructor(public readonly url: string) {
    super(`Redirect to ${url}`);
    this.name = 'AdminRedirectException';
  }
}
