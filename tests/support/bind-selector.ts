/**
 * Local bindSnapshotSelector for standalone component tests. The published
 * `dsh-client-test-runtime` cannot load standalone (imports unshipped source
 * paths). This implementation mirrors the harness's bindSnapshotSelector
 * using React's built-in useSyncExternalStore.
 */
import { useSyncExternalStore } from 'react'

/**
 * Bind an observable source to a React selector hook.
 * @param source - snapshot store (getSnapshot / subscribe).
 * @returns the selector hook.
 */
export function bindSelector<T>(source: { getSnapshot(): T; subscribe(fn: () => void): () => void }) {
  const subscribe = (fn: () => void) => source.subscribe(fn)
  const getSnapshot = () => source.getSnapshot()
  return function useSelector<U>(selector: (s: T) => U): U {
    return useSyncExternalStore(subscribe, () => selector(getSnapshot()))
  }
}