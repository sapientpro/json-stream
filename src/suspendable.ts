export class Suspendable {
  private _suspended: boolean = false;
  private _resume = Promise.withResolvers<any>();
  private _suspend = Promise.withResolvers<any>();

  constructor(private trace = false) {}

  async suspend(value?: any): Promise<any> {
   this.trace && this._trace('Suspending');
    this._suspended = true;
    const {resolve} = this._suspend;
    this._suspend = Promise.withResolvers<any>();
    resolve({ value });
    return await this._resume.promise;
  }

  async resume(value?: any): Promise<any> {
    this.trace && this._trace('Resuming');
    this._suspended = false;
    const {resolve} = this._resume;
    this._resume = Promise.withResolvers<any>();
    resolve({ value });
    return this._suspend.promise;
  }

  get suspended() {
    return this._suspended;
  }

  private _trace(type: string) {
    try {
      throw new Error(type);
    } catch (e: any) {
      console.log(type + ' ' + e.stack.split('\n')[3].trim());
    }
  }
}
