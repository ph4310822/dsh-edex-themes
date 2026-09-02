/**
 * Theme store plugin, browser half: provides the theme store runtime service
 * and registers the Theme Store settings section into the Settings nav.
 *
 * The section mirrors the runtime's catalog snapshot through a declared
 * store; user actions (apply / retry) route through the injected face back to
 * the runtime, which collaborates with the harness theme service (ctx.theme)
 * and the durable `ui-theme-store` settings scope.
 */
import type { BoundActions } from '@deepseek-ai/dsh-client-ui-slots'
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
// Type-only: the ctx.settingsScope Context merge. Cross-plugin collaboration
// goes through the service, never a value import (client bundle purity gate).
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
// Type-only: pulls the locale plugin's Context merge (ctx.locale).
import type {} from '@deepseek-ai/dsh-client-locale/client'
// Type-only: pulls the theme plugin's Context merge (ctx.theme) and types.
import type {} from '@deepseek-ai/dsh-client-ui-theme/client'
// Type-only: pulls the api-remotes merge (ctx.remote) into this compilation.
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type { ThemeStoreSectionInjected } from './ThemeStoreSection.tsx'
import { ThemeStoreSection, LAST_INSTALL_KEY } from './ThemeStoreSection.tsx'
import { createThemeStoreStore } from './settings-store.ts'
import { ThemeStoreRuntime } from './theme-store.ts'
import { en, zh, type ThemeStoreLocaleKey } from './locales.ts'
import {
  THEME_STORE_NAMESPACE, type ThemeStoreSettings,
} from '../theme-store-settings.ts'

export type {
  ThemeStoreSectionComponentProps, ThemeStoreSectionInjected,
} from './ThemeStoreSection.tsx'
export type { ThemeStoreState } from './settings-store.ts'
export { createThemeStoreStore } from './settings-store.ts'
export type { ThemeStoreSnapshot, ThemeStoreStatus } from './theme-store.ts'
export { ThemeStoreRuntime } from './theme-store.ts'
export type { CatalogTheme, ThemeCatalog } from './catalog.ts'
export { parseCatalog, resolveScreenshot } from './catalog.ts'
export type { ThemeStoreLocaleKey } from './locales.ts'
export type { ThemeStoreSettings } from '../theme-store-settings.ts'

/** Namespace owning this feature's settings-row copy. */
export const SETTINGS_NS = 'settings.themeStore'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** The Theme Store settings section's copy. */
    'settings.themeStore': ThemeStoreLocaleKey
  }
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Theme catalog store service: load, apply, and durable applied id. */
    themeStore: ThemeStoreRuntime
  }
}

/**
 * Required services: slots/locale for the section, the settings scope for the
 * durable applied id, the harness theme service, the remote transport, and
 * the plugin inventory Remote to detect installed shell themes.
 */
export const inject = ['slots', 'locale', 'settingsScope', 'theme', 'remote', 'remote.pluginInventory']

/**
 * Client plugin body: provide the theme store service and register the
 * feature-owned Theme Store settings section. On boot, also queries the
 * plugin inventory to detect which shell themes are already installed.
 * @param ctx - client cordis context.
 */
export function apply(ctx: ClientContext): void {
  console.log('[theme-store] 🎨 apply(): theme store plugin ACTIVATED in browser', {
    inject: inject.length,
    url: typeof location !== 'undefined' ? location.href : 'n/a',
  })
  ctx.effect(() => ctx.locale.register(SETTINGS_NS, { zh, en }), 'theme-store: dictionaries')

  const t = ctx.locale.bind(SETTINGS_NS)
  const host = ctx.settingsScope.bind<ThemeStoreSettings>({ namespace: THEME_STORE_NAMESPACE })
  const runtime = new ThemeStoreRuntime(ctx, host, ctx.theme)
  ctx.provide('themeStore', runtime)
  ctx.effect(() => () => { runtime.dispose() }, 'theme-store: runtime disposal')

  const store = createThemeStoreStore()
  let bound: BoundActions<typeof store> | undefined
  const sync = (): void => {
    bound?.sync(runtime.getState())
  }
  ctx.effect(() => runtime.subscribe(sync), 'theme-store: section mirror')

  const injected = (actions: BoundActions<typeof store>): ThemeStoreSectionInjected => {
    bound = actions
    // Re-sync from the getter so no event is lost between registration and
    // first render (the store's revision guard drops stale duplicates).
    sync()
    return {
      load: () => { void runtime.load() },
      apply: (id) => { runtime.apply(id) },
      copyInstall: (command) => {
        void navigator.clipboard?.writeText(command).catch(() => {})
      },
      installShell: async (installPackage, onStage, marker) => {
        console.log('[theme-store] installShell called:', installPackage)
        onStage?.('installing')
        const response = await fetch('/api/theme-store/install', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ installPackage }),
        })
        const result = await response.json().catch(() => ({ ok: false, error: 'invalid response' })) as {
          ok?: boolean
          changed?: boolean
          error?: string
        }
        console.log('[theme-store] install response:', JSON.stringify(result))
        if (result.ok !== true) {
          throw new Error(result.error ?? 'install failed')
        }
        // If the composition changed, the new variant's client rows need a
        // restart to appear in the module graph. Request a respawn, then poll
        // until the server is back and reload so the new shell boots.
        if (result.changed !== false) {
          onStage?.('restarting')
          console.log('[theme-store] requesting restart')
          await fetch('/api/theme-store/restart', { method: 'POST' }).catch((error) => {
            console.log('[theme-store] restart fetch error (expected, server respawning):', String(error))
          })
          onStage?.('reloading')
          console.log('[theme-store] waiting for server to come back')
          await waitForServer()
          // The reload wipes the DevTools console, so persist a visible
          // confirmation marker the section reads back after the page returns.
          if (marker !== undefined) {
            try {
              window.sessionStorage.setItem(LAST_INSTALL_KEY, JSON.stringify(marker))
              console.log('[theme-store] last-install marker written:', JSON.stringify(marker))
            } catch {
              // Storage unavailable — proceed without the marker.
            }
          }
          console.log('[theme-store] server back, reloading page')
          window.location.reload()
        } else {
          console.log('[theme-store] no change needed (already active)')
        }
      },
    }
  }
  ctx.slots.inject('settings.section', () => {
    console.log('[theme-store] settings.section registration running')
    return ctx.slots.register({
      name: 'settings.section',
      id: 'theme-store',
      order: 12,
      label: () => t('nav'),
      locale: SETTINGS_NS,
      store,
      inject: injected,
    }, ThemeStoreSection)
  })

  void runtime.load()

  // Query the plugin inventory for installed shell themes.
  void (async () => {
    try {
      const result = await ctx.remote.pluginInventory.list()
      if (!result.ok) return
      const moduleNames = result.value.entries
        .filter(e => e.enabled)
        .map(e => e.moduleName)
      runtime.syncInstalledShells(moduleNames)
    } catch {
      // Inventory unavailable — remain with no installed shells.
    }
  })()
}

/** Poll the GUI until it responds, then return. Used after a restart-respawn. */
async function waitForServer(): Promise<void> {
  for (let attempt = 0; attempt < 60; attempt++) {
    await new Promise(resolve => setTimeout(resolve, 2000))
    try {
      const res = await fetch('/catalog/edex-themes.json', { method: 'HEAD' })
      if (res.ok) return
    } catch {
      // Server still down — keep polling.
    }
  }
}
