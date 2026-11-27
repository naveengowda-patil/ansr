/**
 * Milliseconds from an arbitrary origin, used for durations and cache ages (blueprint §5.11).
 * Injected so tests control time; only container.ts provides the real one.
 */
export type Clock = () => number;
