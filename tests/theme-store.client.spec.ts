// @vitest-environment node
/** ThemeStoreRuntime: catalog loading, theme application, persistence, and disposal. */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { stubSettingsScope, type StubSettingsScope } from './support/settings-scope.ts'
import { FakeThemeRuntime } from './support/theme-double.ts'
import { ThemeStoreRuntime } from '../src/client/theme-store.ts'
import type { ThemeStoreSettings } from '../src/theme-store-settings.ts'

const CATALOG_DOC = {
  themes: [
    { id: 'ocean', name: 'Ocean', author: 'a', screenshot: 's.png', colorScheme: 'dark', tokens: { '--x': '#000' } },
    { id: 'forest', name: 'Forest', author: 'a', screenshot: 's.png', colorScheme: 'dark', tokens: { '--x': '#111' } },
  ],
}

const CATALOG_URL = 'https://example.com/themes.json'

function mockFetch(json: unknown): void {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(json), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })))
}

function bench(): {
  ctx: Context
  storeHost: StubSettingsScope<ThemeStoreSettings>
  theme: FakeThemeRuntime
  runtime: ThemeStoreRuntime
} {
  const ctx = new Context()
  const theme = new FakeThemeRuntime(ctx)
  const storeHost = stubSettingsScope<ThemeStoreSettings>()
  const runtime = new ThemeStoreRuntime(ctx, storeHost.scope, theme as never, CATALOG_URL)
  return { ctx, storeHost, theme, runtime }
}

afterEach(() => { vi.unstubAllGlobals() })

describe('ThemeStoreRuntime', () => {
  it('starts idle with no themes and no applied theme', () => {
    const { runtime } = bench()
    const state = runtime.getState()
    expect(state.status).toBe('idle')
    expect(state.themes).toHaveLength(0)
    expect(state.applied).toBeUndefined()
  })

  it('loads a catalog and transitions to ready', async () => {
    const { runtime } = bench()
    mockFetch(CATALOG_DOC)
    await runtime.load()
    const state = runtime.getState()
    expect(state.status).toBe('ready')
    expect(state.themes).toHaveLength(2)
    expect(state.themes[0]!.id).toBe('ocean')
    expect(state.error).toBeUndefined()
  })

  it('transitions to error on fetch failure', async () => {
    const { runtime } = bench()
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('network') }))
    await runtime.load()
    const state = runtime.getState()
    expect(state.status).toBe('error')
    expect(state.error).toMatch(/network/)
    expect(state.themes).toHaveLength(0)
  })

  it('falls back to the bundled local catalog when the configured source fails', async () => {
    const { runtime } = bench()
    const fetchMock = vi.fn(async (url: string) => {
      if (url === 'https://example.com/themes.json') throw new Error('github down')
      return new Response(JSON.stringify(CATALOG_DOC), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    })
    vi.stubGlobal('fetch', fetchMock)
    await runtime.load()
    const state = runtime.getState()
    expect(state.status).toBe('ready')
    expect(state.themes).toHaveLength(2)
    // Primary (GitHub) tried first, then the local fallback.
    expect(fetchMock.mock.calls.map(call => call[0]))
      .toEqual(['https://example.com/themes.json', '/catalog/edex-themes.json'])
  })

  it('applies a catalog theme: registers, setTheme, persists', async () => {
    const { runtime, storeHost, theme } = bench()
    mockFetch(CATALOG_DOC)
    await runtime.load()
    runtime.apply('ocean')
    expect(theme.getTheme().preference).toBe('ocean')
    expect(theme.getTheme().themes.some(t => t.id === 'ocean')).toBe(true)
    expect(storeHost.set).toHaveBeenCalledWith('applied', 'ocean')
  })

  it('throws applying an unknown theme', async () => {
    const { runtime } = bench()
    mockFetch(CATALOG_DOC)
    await runtime.load()
    expect(() => runtime.apply('unknown')).toThrow(/not in the catalog/)
  })

  it('re-applies a persisted theme from the settings scope on ready', async () => {
    const { runtime, storeHost, theme } = bench()
    storeHost.publish({ status: 'ready', value: { applied: 'forest' }, revision: 1, writable: true })
    mockFetch(CATALOG_DOC)
    await runtime.load()
    expect(theme.getTheme().preference).toBe('forest')
    expect(theme.getTheme().themes.some(t => t.id === 'forest')).toBe(true)
  })

  it('updates applied from theme/change events', async () => {
    const { runtime, theme } = bench()
    mockFetch(CATALOG_DOC)
    await runtime.load()
    theme.setTheme('dark')
    // 'dark' is a built-in, not in catalog → applied becomes undefined.
    expect(runtime.getState().applied).toBeUndefined()
    runtime.apply('ocean')
    expect(runtime.getState().applied).toBe('ocean')
    theme.setTheme('dark')
    expect(runtime.getState().applied).toBeUndefined()
  })

  it('subscribes listeners and fires on state changes', async () => {
    const { runtime } = bench()
    mockFetch(CATALOG_DOC)
    const listener = vi.fn()
    const off = runtime.subscribe(listener)
    await runtime.load()
    // load publishes loading + ready.
    expect(listener).toHaveBeenCalledTimes(2)
    const beforeApply = listener.mock.calls.length
    runtime.apply('ocean')
    // apply publishes once (applied changed).
    expect(listener).toHaveBeenCalledTimes(beforeApply + 1)
    // Applying the same theme again is a no-op publish-wise (setTheme no-ops,
    // applied unchanged → no publish).
    runtime.apply('ocean')
    expect(listener).toHaveBeenCalledTimes(beforeApply + 1)
    off()
    runtime.apply('forest')
    expect(listener).toHaveBeenCalledTimes(beforeApply + 1)
  })

  it('dispose releases theme registrations, listeners, and resets preference', async () => {
    const { ctx, runtime, theme, storeHost } = bench()
    mockFetch(CATALOG_DOC)
    await runtime.load()
    runtime.apply('ocean')
    expect(theme.getTheme().preference).toBe('ocean')
    expect(storeHost.listenerCount()).toBeGreaterThan(0)
    runtime.dispose()
    // Active theme was unregistered → preference reset to default.
    expect(theme.getTheme().preference).toBe('system')
    // Listeners freed.
    expect(storeHost.listenerCount()).toBe(0)
    // Second dispose is a no-op.
    runtime.dispose()
    // The cordis context still works after dispose.
    expect(ctx).toBeDefined()
  })
})
