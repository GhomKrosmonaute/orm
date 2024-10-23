export interface ResponseCacheData<Value> {
  value: Value
  expires: number
  outdated?: boolean
}

/**
 * Advanced cache for async queries
 */
export class ResponseCache<Params extends any[], Value> {
  private _cache = new Map<string, ResponseCacheData<Value>>()

  constructor(
    private _request: (...params: Params) => Value,
    private _timeout: number,
  ) {}

  get(id: string, ...params: Params): Value {
    const cached = this._cache.get(id)

    if (!cached || cached.expires < Date.now()) {
      this._cache.set(id, {
        value: this._request(...params),
        expires: Date.now() + this._timeout,
      })
    }

    return this._cache.get(id)!.value
  }

  fetch(id: string, ...params: Params): Value {
    this._cache.set(id, {
      value: this._request(...params),
      expires: Date.now() + this._timeout,
    })

    return this._cache.get(id)!.value
  }

  invalidate(): void
  invalidate(id: string): void
  invalidate(id?: string): void {
    if (!id) {
      this._cache.clear()

      return
    }

    this._cache.delete(id)
  }
}
