/**
 * Local doubles for the harness client runtime surface this package imports:
 * `defineStore` and `createSnapshotStore`. The published npm client bundles
 * are closure-factory loader artifacts (not directly importable in Node), so
 * standalone tests alias `@deepseek-ai/dsh-client-runtime/client` to this
 * file. Only the exact contract shapes this package uses are implemented.
 */

/** Minimal observable snapshot store. */
export interface SnapshotStore<T> {
  getSnapshot(): T
  subscribe(fn: () => void): () => void
  set(next: T): void
  update(mutator: (draft: T) => void): void
}

/** Create a minimal snapshot store (matching the runtime client contract). */
export function createSnapshotStore<T>(init: T): SnapshotStore<T> {
  let state = init
  const listeners = new Set<() => void>()
  const notify = () => { for (const fn of listeners) fn() }
  return {
    getSnapshot: () => state,
    subscribe(fn) { listeners.add(fn); return () => { listeners.delete(fn) } },
    set(next) { state = next; notify() },
    update(mutator) {
      const draft = structuredClone(state)
      mutator(draft)
      state = draft
      notify()
    },
  }
}

/** Actions declaration: draft-first mutators. */
export type ActionsDecl<T> = Record<string, (draft: T, ...args: never[]) => void>

/** Store handle contract (narrowed to what this package consumes). */
export interface EngineStoreHandle<T, A extends ActionsDecl<T>> {
  create(): EngineStoreInstance<T, A>
}

/** Live store instance: getSnapshot/subscribe + baked (draft-stripped) actions. */
export interface EngineStoreInstance<T, A extends ActionsDecl<T>> {
  getSnapshot(): T
  subscribe(fn: () => void): () => void
  actions: BakedActions<A>
  store: SnapshotStore<T>
}

/** Strip the leading draft parameter from each action. */
export type BakedActions<A> = {
  [K in keyof A]: A[K] extends (draft: unknown, ...args: infer R) => void
    ? (...args: R) => void
    : never
}

/** Declare a store: init + draft mutators → a handle whose create() mints instances. */
export function defineStore<T, A extends ActionsDecl<T>>(spec: {
  init: () => T
  actions: A
}): EngineStoreHandle<T, A> {
  return {
    create() {
      const store = createSnapshotStore<T>(spec.init())
      const baked = {} as BakedActions<A>
      for (const key of Object.keys(spec.actions) as (keyof A)[]) {
        const mutator = spec.actions[key]
        baked[key] = ((...args: unknown[]) => {
          const draft = structuredClone(store.getSnapshot())
          ;(mutator as (draft: T, ...rest: unknown[]) => void)(draft, ...args)
          store.set(draft)
        }) as BakedActions<A>[typeof key]
      }
      return { getSnapshot: store.getSnapshot, subscribe: store.subscribe, actions: baked, store }
    },
  }
}
