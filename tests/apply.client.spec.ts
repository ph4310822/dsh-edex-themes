// @vitest-environment node
/** ui-theme-store apply wiring: service provision, section registration, dictionaries, load trigger. */
import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { stubSettingsScope } from './support/settings-scope.ts'
import { FakeThemeRuntime } from './support/theme-double.ts'
import { apply, inject, SETTINGS_NS } from '../src/client/index.ts'
import type { ThemeStoreSettings } from '../src/theme-store-settings.ts'
import { ThemeStoreSection } from '../src/client/ThemeStoreSection.tsx'

/** Minimal slots double: inject runs the factory immediately, register records entries. */
function fakeSlots() {
  const entries = new Map<string, { options: Record<string, unknown>; component: unknown }[]>()
  const injectCalls: string[] = []
  return {
    slots: {
      register(options: Record<string, unknown>, component: unknown) {
        const name = String(options.name)
        const list = entries.get(name) ?? []
        const record = { options, component }
        list.push(record)
        entries.set(name, list)
        return () => {
          const current = entries.get(name) ?? []
          entries.set(name, current.filter(entry => entry !== record))
        }
      },
      inject(name: string, factory: () => unknown) {
        injectCalls.push(name)
        // The harness waits on the slot declaration; here the declaration is
        // considered present, so the factory runs and its registration is kept.
        factory()
        return () => {}
      },
    },
    entries,
    injectCalls,
  }
}

/** Minimal locale double: register records dictionaries, bind reads the active locale. */
function fakeLocale() {
  const dicts = new Map<string, { zh: Record<string, string>; en: Record<string, string> }>()
  let active: 'zh' | 'en' = 'zh'
  return {
    locale: {
      register(ns: string, dict: { zh: Record<string, string>; en: Record<string, string> }) {
        dicts.set(ns, dict)
        return () => { dicts.delete(ns) }
      },
      bind(ns: string) {
        return (key: string): string => dicts.get(ns)?.[active]?.[key] ?? key
      },
    },
    dicts,
    setLocale(locale: 'zh' | 'en') { active = locale },
  }
}

function bench() {
  const ctx = new Context()
  const theme = new FakeThemeRuntime(ctx)
  const settingsHost = stubSettingsScope<ThemeStoreSettings>()
  const slots = fakeSlots()
  const locale = fakeLocale()
  ctx.provide('slots', slots.slots as never)
  ctx.provide('locale', locale.locale as never)
  ctx.provide('settingsScope', { bind: () => settingsHost.scope } as never)
  ctx.provide('theme', theme as never)
  // The plugin inventory remote never holds any shell plugins in tests.
  ctx.provide('remote', { pluginInventory: { list: async () => ({ ok: true, value: { entries: [] } }) } } as never)
  ctx.provide('remote.pluginInventory', { list: async () => ({ ok: true, value: { entries: [] } }) } as never)
  return { ctx, theme, settingsHost, slots, locale }
}

describe('ui-theme-store apply', () => {
  it('declares the required services', () => {
    expect(inject).toEqual(['slots', 'locale', 'settingsScope', 'theme', 'remote', 'remote.pluginInventory'])
  })

  it('provides the themeStore service and registers the section with localized copy', async () => {
    const b = bench()
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ themes: [] }), { status: 200 })))
    const fiber = b.ctx.plugin({ inject: [...inject], apply })
    await fiber.await()

    // Service provided on ctx.
    const runtime = b.ctx.get('themeStore') as { getState(): { status: string } }
    expect(runtime).toBeDefined()
    // The boot load was triggered.
    expect(b.slots.injectCalls).toContain('settings.section')
    const sectionEntries = b.slots.entries.get('settings.section') ?? []
    expect(sectionEntries).toHaveLength(1)
    const registration = sectionEntries[0]!.options
    expect(registration).toMatchObject({ id: 'theme-store', order: 12, locale: SETTINGS_NS })
    expect(sectionEntries[0]!.component).toBe(ThemeStoreSection)
    // Nav label is a localized thunk.
    const label = registration.label as () => string
    expect(label()).toBe('主题商店')
    await fiber.dispose()
  })

  it('registers zh/en dictionaries and loads the catalog', async () => {
    const b = bench()
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ themes: [] }), { status: 200 })))
    const fiber = b.ctx.plugin({ inject: [...inject], apply })
    await fiber.await()
    expect(b.locale.dicts.has(SETTINGS_NS)).toBe(true)
    await vi.waitFor(() => { expect(fetch).toHaveBeenCalled() })
    await fiber.dispose()
  })
})
