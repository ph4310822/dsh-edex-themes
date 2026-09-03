/**
 * Theme store runtime: owns catalog loading, theme registration/application
 * through the harness theme service, and durable persistence of the applied
 * third-party theme id in the `ui-theme-store` settings namespace.
 *
 * The runtime is a business service (never touches DOM/React); the settings
 * section mirrors its state through a declared store. It publishes an
 * immutable {@link ThemeStoreSnapshot} on every change through the snapshot
 * store it exposes (`getState`/`subscribe`).
 */
import type { Context } from '@deepseek-ai/cordis'
import type { SettingsScope } from '@deepseek-ai/dsh-client-runtime/client'
import type { ThemeRuntime, ThemeSnapshot } from '@deepseek-ai/dsh-client-ui-theme/client'
import { createSnapshotStore, type SnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'
import { catalogUrl, fetchCatalog, LOCAL_CATALOG_URL, type CatalogTheme, type ThemeCatalog } from './catalog.ts'
import type { ThemeStoreSettings } from '../theme-store-settings.ts'

/** Catalog loading phase. */
export type ThemeStoreStatus = 'idle' | 'loading' | 'ready' | 'error'

/** Immutable theme store state published on every change. */
export interface ThemeStoreSnapshot {
  /** Catalog loading phase. */
  status: ThemeStoreStatus
  /** Loaded catalog themes in display order (empty until ready). */
  themes: readonly CatalogTheme[]
  /** Id of the currently applied catalog theme (undefined when a built-in preference is active). */
  applied: string | undefined
  /** Shell plugin package ids currently installed in the active profile (inventory detection). */
  installedShells: readonly string[]
  /** Human-readable load error (undefined unless status is `error`). */
  error: string | undefined
  /** Monotonic change counter (status, themes, or applied changes). */
  revision: number
}

/**
 * Theme catalog store: loads the repository catalog, registers catalog themes
 * with the harness theme service on apply (lazily, so a duplicate id never
 * throws at load), tracks which shell plugins the active profile has
 * installed, and persists the applied theme id across reloads.
 */
export class ThemeStoreRuntime {
  private readonly host: SettingsScope<ThemeStoreSettings>
  private readonly theme: ThemeRuntime
  private readonly href: string
  private readonly store: SnapshotStore<ThemeStoreSnapshot>
  /** Theme ids this runtime registered with the theme service (id → disposer). */
  private readonly registered = new Map<string, () => void>()
  /** The active applied theme id. */
  private applied: string | undefined = undefined
  private disposed = false
  private readonly offTheme: (() => void) | undefined
  private readonly offHost: (() => void) | undefined

  /**
   * @param ctx - owning context (change and theme listeners are released on dispose).
   * @param host - durable `ui-theme-store` scope owned by the same plugin.
   * @param theme - harness theme service (register/setTheme).
   * @param href - catalog document URL (defaults to the build-time catalog URL).
   */
  constructor(ctx: Context, host: SettingsScope<ThemeStoreSettings>, theme: ThemeRuntime, href = catalogUrl()) {
    this.host = host
    this.theme = theme
    this.href = href
    this.store = createSnapshotStore<ThemeStoreSnapshot>({
      status: 'idle',
      themes: [],
      applied: undefined,
      installedShells: [],
      error: undefined,
      revision: 0,
    })
    // Track which catalog theme is active from the theme service preference.
    this.offTheme = ctx.on('theme/change', (snapshot) => { this.adoptApplied(snapshot) })
    this.adoptApplied(theme.getTheme())
    // Adopt a persisted applied id once the scope resolves.
    this.offHost = host.subscribe(() => { this.adoptPersisted() })
    this.adoptPersisted()
  }

  /** @returns the current immutable snapshot (stable reference until the next change). */
  getState(): ThemeStoreSnapshot {
    return this.store.getSnapshot()
  }

  /** Observe snapshot replacements. @returns the disposer. */
  subscribe(listener: () => void): () => void {
    return this.store.subscribe(listener)
  }

  /**
   * Load the catalog from the configured URL and reconcile the persisted
   * applied theme. If the live (GitHub) source is unreachable, falls back to
   * the bundled catalog served by the node half. Safe to call repeatedly
   * (retry); a total failure leaves the previous ready state intact and
   * reports an error snapshot.
   * @returns completion of the load.
   */
  async load(): Promise<void> {
    if (this.disposed) return
    this.publish({ status: 'loading', error: undefined })
    try {
      const catalog = await this.fetchCatalogWithFallback()
      if (this.disposed) return
      this.publish({ status: 'ready', themes: catalog.themes, error: undefined })
      this.adoptPersisted()
    } catch (error) {
      if (this.disposed) return
      this.publish({
        status: 'error',
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }

  /**
   * Fetch the catalog, falling back to the bundled local route when the
   * configured (GitHub) source fails. A non-GitHub href is tried as-is; when
   * it and the local fallback both fail, the original error surfaces.
   * @returns the fetched catalog.
   */
  private async fetchCatalogWithFallback(): Promise<ThemeCatalog> {
    try {
      return await fetchCatalog(this.href)
    } catch (primaryError) {
      if (this.href === LOCAL_CATALOG_URL) throw primaryError
      try {
        return await fetchCatalog(LOCAL_CATALOG_URL)
      } catch {
        throw primaryError
      }
    }
  }

  /**
   * Apply a catalog theme: register it with the harness theme service if
   * needed, switch the active preference to it, and persist the id.
   * @param id - a catalog theme id.
   */
  apply(id: string): void {
    if (this.disposed) return
    const theme = this.getState().themes.find(candidate => candidate.id === id)
    if (theme === undefined) throw new Error(`theme "${id}" is not in the catalog`)
    this.ensureRegistered(theme)
    this.theme.setTheme(id)
    void this.host.set('applied', id)
  }

  /**
   * Adopt the currently installed shell plugin ids from the profile's plugin
   * inventory. The store reports shell themes as "installed" when their
   * `shellPluginId` appears here; color themes are unaffected.
   * @param shellPluginIds - module names of installed client shell plugins.
   */
  syncInstalledShells(shellPluginIds: readonly string[]): void {
    if (this.disposed) return
    const current = this.getState().installedShells
    const next = [...new Set(shellPluginIds)].sort()
    if (current.length === next.length && current.every((value, index) => value === next[index])) return
    this.publish({ installedShells: next })
  }

  /**
   * Release the plugin's registrations and listeners. Disposing the active
   * theme resets the harness preference to its default, exactly as the theme
   * service's own disposer contract specifies.
   */
  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.offTheme?.()
    this.offHost?.()
    for (const dispose of this.registered.values()) dispose()
    this.registered.clear()
  }

  private ensureRegistered(theme: CatalogTheme): void {
    if (this.registered.has(theme.id)) return
    if (this.theme.getTheme().themes.some(candidate => candidate.id === theme.id)) return
    const dispose = this.theme.register({ id: theme.id, colorScheme: theme.colorScheme, tokens: theme.tokens })
    this.registered.set(theme.id, dispose)
  }

  /** Keep `applied` in sync with the theme service's active preference. */
  private adoptApplied(snapshot: ThemeSnapshot): void {
    const preference = snapshot.preference
    const active = this.getState().themes.some(theme => theme.id === preference)
      ? preference
      : undefined
    if (active === this.applied) return
    this.applied = active
    this.publish({ applied: active })
  }

  /** Restore a persisted applied theme id once the catalog is ready. */
  private adoptPersisted(): void {
    if (this.disposed) return
    const section = this.host.getSnapshot().value
    if (section === undefined || section.applied === '') return
    const id = section.applied
    const theme = this.getState().themes.find(candidate => candidate.id === id)
    if (theme === undefined || this.applied === id) return
    this.ensureRegistered(theme)
    this.theme.setTheme(id)
  }

  private publish(partial: Partial<ThemeStoreSnapshot>): void {
    const current = this.store.getSnapshot()
    this.store.set({
      ...current,
      ...partial,
      revision: current.revision + 1,
    })
  }
}