/**
 * Theme store section slot store: mirrors the theme store runtime snapshot.
 * The plugin's apply-world change listener is the only writer; the section
 * component reads via props.useStore.
 */
import { defineStore, type EngineStoreHandle } from '@deepseek-ai/dsh-client-runtime/client'
import type { ThemeStoreStatus } from './theme-store.ts'
import type { ThemeStoreSnapshot } from './theme-store.ts'
import type { CatalogTheme } from './catalog.ts'

/** Store state mirrored from the theme store runtime. */
export interface ThemeStoreState {
  /** Catalog loading phase. */
  status: ThemeStoreStatus
  /** Loaded catalog themes (empty until ready). */
  themes: readonly CatalogTheme[]
  /** Applied catalog theme id (undefined when built-in light/dark/system is active). */
  applied: string | undefined
  /** Shell plugin package ids currently installed in the active profile. */
  installedShells: readonly string[]
  /** Human-readable load error. */
  error: string | undefined
  /** Runtime revision; -1 until first sync so revision 0 lands as a change. */
  revision: number
}

/** Declared action shape giving the exported factory a stable return type. */
type ThemeStoreActions = {
  sync: (draft: ThemeStoreState, snapshot: ThemeStoreSnapshot) => void
}

/**
 * Declares the theme store section state and write surface.
 * @returns the store handle.
 */
export function createThemeStoreStore(): EngineStoreHandle<ThemeStoreState, ThemeStoreActions> {
  return defineStore({
    init: (): ThemeStoreState => ({
      status: 'idle',
      themes: [],
      applied: undefined,
      installedShells: [],
      error: undefined,
      revision: -1,
    }),
    actions: {
      sync: (draft, snapshot) => {
        if (snapshot.revision <= draft.revision) return
        draft.status = snapshot.status
        draft.themes = snapshot.themes
        draft.applied = snapshot.applied
        draft.installedShells = snapshot.installedShells
        draft.error = snapshot.error
        draft.revision = snapshot.revision
      },
    },
  })
}