// Shamelessly stolen (and modified) from @latticexyz/phaserx (Love you all <3)

export function deferred<T>(): [
  (t: T) => void,
  (t: Error) => void,
  Promise<T>
] {
  let resolve: ((t: T) => void) | null = null;
  let reject: ((t: Error) => void) | null = null;
  const promise = new Promise<T>((r, rj) => {
    resolve = (t: T) => r(t);
    reject = (e: Error) => rj(e);
  });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return [resolve as any, reject as any, promise];
}
