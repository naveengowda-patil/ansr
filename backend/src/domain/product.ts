/** Product as exposed by the API (blueprint §5.4, §6.1). */
export interface Rating {
  readonly rate: number;
  readonly count: number;
}

export interface Product {
  readonly id: number;
  readonly title: string;
  readonly description: string;
  readonly category: string;
  /** Major units, e.g. 109.95. */
  readonly price: number;
  /** ISO 4217 code, set by the source adapter. */
  readonly currency: string;
  readonly rating: Rating;
}
