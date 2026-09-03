// @vitest-environment node
/** Catalog parsing, screenshot resolution, URL resolution, and fetch loading. */
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  catalogUrl, fetchCatalog, parseCatalog, resolveScreenshot,
  type ThemeCatalog,
} from '../src/client/catalog.ts'

const VALID = {
  themes: [
    {
      id: 'ocean',
      name: 'Ocean',
      author: 'dsh-edex',
      screenshot: 'screenshots/ocean.svg',
      colorScheme: 'dark',
      tokens: { '--dsw-alias-bg-base': '#0d1b2a' },
    },
  ],
} satisfies ThemeCatalog

const DOC_URL = 'https://example.com/catalog/themes.json'

afterEach(() => { vi.unstubAllGlobals() })

describe('parseCatalog', () => {
  it('accepts a valid category-free catalog and returns defensive copies', () => {
    const parsed = parseCatalog(VALID)
    expect(parsed.themes).toHaveLength(1)
    expect(parsed.themes[0]).toMatchObject({ id: 'ocean', name: 'Ocean', author: 'dsh-edex', screenshot: 'screenshots/ocean.svg' })
    parsed.themes[0]!.tokens['--dsw-alias-bg-base'] = 'mutated'
    expect((parseCatalog(VALID).themes[0]!.tokens)['--dsw-alias-bg-base']).toBe('#0d1b2a')
  })

  it('rejects a non-object document', () => {
    for (const value of [null, [], 'catalog', 42]) {
      expect(() => parseCatalog(value)).toThrow(/themes/)
    }
  })

  it('rejects a document without a themes array', () => {
    expect(() => parseCatalog({})).toThrow(/themes/)
    expect(() => parseCatalog({ themes: 'x' })).toThrow(/themes/)
  })

  it('rejects non-object entries, missing display fields, and duplicate ids', () => {
    expect(() => parseCatalog({ themes: ['ocean'] })).toThrow(/object/)
    expect(() => parseCatalog({ themes: [{ id: 'ocean', author: 'a', screenshot: 's', colorScheme: 'dark', tokens: {} }] }))
      .toThrow(/name/)
    expect(() => parseCatalog({ themes: [VALID.themes[0], VALID.themes[0]] })).toThrow(/duplicate/)
  })

  it('rejects a bad colorScheme and a malformed tokens map', () => {
    expect(() => parseCatalog({ themes: [{ ...VALID.themes[0], colorScheme: 'sepia' }] })).toThrow(/colorScheme/)
    expect(() => parseCatalog({ themes: [{ ...VALID.themes[0], tokens: 'x' }] })).toThrow(/tokens/)
    expect(() => parseCatalog({ themes: [{ ...VALID.themes[0], tokens: { x: 1 } }] })).toThrow(/string/)
  })

  it('preserves shell theme fields (type/installPackage/shellPluginId/installHint)', () => {
    const parsed = parseCatalog({
      themes: [{
        ...VALID.themes[0],
        type: 'shell',
        installPackage: '@danielng23/dsh-edex-armory-ui',
        shellPluginId: '@danielng23/dsh-armory-client-ui-edex',
        installHint: 'dsh plugin --profile <name> add @danielng23/dsh-edex-armory-ui',
      }],
    })
    const theme = parsed.themes[0]!
    expect(theme.type).toBe('shell')
    expect(theme.installPackage).toBe('@danielng23/dsh-edex-armory-ui')
    expect(theme.shellPluginId).toBe('@danielng23/dsh-armory-client-ui-edex')
    expect(theme.installHint).toMatch(/^dsh plugin/)
  })

  it('keeps shell fields absent for plain color themes', () => {
    const theme = parseCatalog(VALID).themes[0]!
    expect(theme.type).toBeUndefined()
    expect(theme.installPackage).toBeUndefined()
    expect(theme.shellPluginId).toBeUndefined()
    expect(theme.installHint).toBeUndefined()
  })
})

describe('resolveScreenshot', () => {
  it('leaves absolute URLs untouched and resolves relative paths against the catalog directory', () => {
    expect(resolveScreenshot('https://cdn.example/x.png', DOC_URL)).toBe('https://cdn.example/x.png')
    expect(resolveScreenshot('screenshots/ocean.svg', DOC_URL))
      .toBe('https://example.com/catalog/screenshots/ocean.svg')
    expect(resolveScreenshot('/abs/root.png', DOC_URL)).toBe('https://example.com/abs/root.png')
  })
})

describe('catalogUrl', () => {
  it('defaults to the live GitHub catalog', () => {
    vi.stubEnv('DSH_CLIENT_THEME_STORE_CATALOG_URL', undefined)
    expect(catalogUrl()).toBe('https://raw.githubusercontent.com/ph4310822/dsh-edex-themes/main/catalog/edex-themes.json')
  })

  it('honors the build-time override and ignores an empty override', () => {
    vi.stubEnv('DSH_CLIENT_THEME_STORE_CATALOG_URL', 'https://example.com/themes.json')
    expect(catalogUrl()).toBe('https://example.com/themes.json')
    vi.stubEnv('DSH_CLIENT_THEME_STORE_CATALOG_URL', '')
    expect(catalogUrl()).toBe('https://raw.githubusercontent.com/ph4310822/dsh-edex-themes/main/catalog/edex-themes.json')
  })
})

describe('fetchCatalog', () => {
  it('fetches and parses a catalog from a URL', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(VALID), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })))
    const catalog = await fetchCatalog(DOC_URL)
    expect(catalog.themes[0]!.id).toBe('ocean')
    expect(fetch).toHaveBeenCalledWith(DOC_URL, expect.objectContaining({ headers: expect.anything() }))
  })

  it('surfaces a network failure with a teaching message', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline') }))
    await expect(fetchCatalog(DOC_URL)).rejects.toThrow(/unreachable.*offline/)
  })

  it('surfaces a non-OK response', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('nope', { status: 404 })))
    await expect(fetchCatalog(DOC_URL)).rejects.toThrow(/HTTP 404/)
  })

  it('surfaces malformed JSON and invalid catalog shapes', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('not json', { status: 200 })))
    await expect(fetchCatalog(DOC_URL)).rejects.toThrow(/not valid JSON/)
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ themes: 'x' }), { status: 200 })))
    await expect(fetchCatalog(DOC_URL)).rejects.toThrow(/themes/)
  })
})
