// @vitest-environment jsdom
/** ThemeStoreSection behavior: loading/error/empty/ready states, cards, apply routing. */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { createThemeStoreStore } from '../src/client/settings-store.ts'
import { ThemeStoreSection, type ThemeStoreSectionComponentProps } from '../src/client/ThemeStoreSection.tsx'
import { bindSelector } from './support/bind-selector.ts'
import type { ThemeStoreState } from '../src/client/settings-store.ts'

afterEach(() => {
  cleanup()
  window.sessionStorage.clear()
})

const COPY: Record<string, string> = {
  title: 'Theme Store',
  subtitle: 'Install color themes and full UI shells',
  loading: 'Reading the theme catalog…',
  error: 'The theme catalog is temporarily unavailable.',
  retry: 'Retry',
  empty: 'No themes in the catalog yet.',
  author: 'Author',
  light: 'Light',
  dark: 'Dark',
  apply: 'Apply',
  applied: 'Applied',
  install: 'Install',
  installing: 'Installing…',
  restarting: 'Restarting to apply…',
  shellInstallNote: 'Full UI requires pnpm install',
  shellTheme: 'UI shell',
  installedBanner: 'Installed and restarted “{name}” — the new UI shell is live.',
  dismiss: 'Dismiss',
}

function mount(initial: Partial<ThemeStoreState> = {}) {
  const store = createThemeStoreStore().create()
  const base: ThemeStoreState = { status: 'idle', themes: [], applied: undefined, installedShells: [], error: undefined, revision: -1 }
  if (Object.keys(initial).length > 0) {
    act(() => { store.store.set({ ...base, ...initial, revision: 0 }) })
  }
  const apply = vi.fn()
  const load = vi.fn()
  const copyInstall = vi.fn()
  const installShell = vi.fn(async () => {})
  const props: ThemeStoreSectionComponentProps = {
    close: () => {},
    useStore: bindSelector(store),
    actions: store.actions,
    t: (key: string) => COPY[key] ?? key,
    apply,
    load,
    copyInstall,
    installShell,
  }
  render(<ThemeStoreSection {...props} />)
  return { store, apply, load, copyInstall, installShell }
}

const THEMES = [
  { id: 'ocean', name: 'Ocean', author: 'dsh-edex', screenshot: 'https://x/o.svg', colorScheme: 'dark', tokens: { '--a': '#111' } },
  { id: 'mono', name: 'Mono', author: 'dsh-edex', screenshot: 'https://x/m.svg', colorScheme: 'light', tokens: { '--a': '#222' } },
]

const SHELL_THEME = {
  id: 'armory',
  name: 'Armory',
  author: '@danielng23',
  screenshot: 'https://x/a.svg',
  colorScheme: 'dark',
  type: 'shell' as const,
  installPackage: '@danielng23/dsh-edex-armory-ui',
  shellPluginId: '@danielng23/dsh-armory-client-ui-edex',
  installHint: 'dsh plugin --profile theme-store add @danielng23/dsh-edex-armory-ui',
  tokens: { '--a': '#111' },
}

describe('ThemeStoreSection', () => {
  it('shows the loading line while the catalog loads', () => {
    mount({ status: 'loading' })
    expect(screen.getByText('Reading the theme catalog…')).toBeDefined()
    expect(screen.getByText('Theme Store')).toBeDefined()
  })

  it('shows an error line with a working retry button', () => {
    const b = mount({ status: 'error', error: 'HTTP 500' })
    expect(screen.getByRole('alert')).toBeDefined()
    expect(screen.getByText('HTTP 500')).toBeDefined()
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(b.load).toHaveBeenCalledOnce()
  })

  it('shows the empty line when the catalog has no themes', () => {
    mount({ status: 'ready', themes: [] })
    expect(screen.getByText('No themes in the catalog yet.')).toBeDefined()
  })

  it('renders a card per theme with name, author, scheme, and an apply button', () => {
    mount({ status: 'ready', themes: THEMES })
    expect(screen.getByText('Ocean')).toBeDefined()
    expect(screen.getByText('Mono')).toBeDefined()
    expect(screen.getAllByText(/^Author: .*$/)).toHaveLength(2)
    expect(screen.getAllByText('Dark')).toHaveLength(1)
    expect(screen.getAllByText('Light')).toHaveLength(1)
    expect(screen.getByRole('button', { name: 'Apply Ocean' })).toBeDefined()
    expect(screen.getByRole('button', { name: 'Apply Mono' })).toBeDefined()
  })

  it('routes an apply click to the injected face with the theme id', () => {
    const b = mount({ status: 'ready', themes: THEMES })
    fireEvent.click(screen.getByRole('button', { name: 'Apply Ocean' }))
    expect(b.apply).toHaveBeenCalledWith('ocean')
  })

  it('marks the applied theme as Applied and disables its button', () => {
    mount({ status: 'ready', themes: THEMES, applied: 'mono' })
    const applied = screen.getByRole('button', { name: 'Applied Mono' })
    expect((applied as HTMLButtonElement).disabled).toBe(true)
    expect(screen.getByRole('button', { name: 'Apply Ocean' })).toBeDefined()
  })

  it('shows an install box for a not-installed shell theme and installs on click', async () => {
    const b = mount({ status: 'ready', themes: [SHELL_THEME], installedShells: [] })
    expect(screen.getByText(/^Full UI requires pnpm install/)).toBeDefined()
    const command = screen.getByText('dsh plugin --profile theme-store add @danielng23/dsh-edex-armory-ui')
    expect(command).toBeDefined()
    fireEvent.click(screen.getByRole('button', { name: 'Install Armory' }))
    await act(async () => { await Promise.resolve() })
    expect(b.installShell).toHaveBeenCalledWith(
      '@danielng23/dsh-edex-armory-ui',
      expect.any(Function),
      expect.objectContaining({ id: 'armory', name: 'Armory' }),
    )
  })

  it('shows a progress bar and stage label while installing', async () => {
    const b = mount({ status: 'ready', themes: [SHELL_THEME], installedShells: [] })
    let onStage: ((stage: string) => void) | undefined
    b.installShell.mockImplementation(async (_pkg, stage) => { onStage = stage })
    fireEvent.click(screen.getByRole('button', { name: 'Install Armory' }))
    await act(async () => { await Promise.resolve() })
    expect(onStage).toBeDefined()
    act(() => { onStage!('installing') })
    expect(screen.getByRole('progressbar')).toBeDefined()
    expect(screen.getByText('Installing…')).toBeDefined()
    act(() => { onStage!('restarting') })
    expect(screen.getByText('Restarting to apply…')).toBeDefined()
  })

  it('shows an install error when the install fails', async () => {
    const b = mount({ status: 'ready', themes: [SHELL_THEME], installedShells: [] })
    b.installShell.mockRejectedValue(new Error('pnpm not found'))
    fireEvent.click(screen.getByRole('button', { name: 'Install Armory' }))
    await vi.waitFor(() => {
      expect(screen.getByRole('alert')).toBeDefined()
      expect(screen.getByText('pnpm not found')).toBeDefined()
    })
  })

  it('shows an Apply button for an installed shell theme', () => {
    mount({
      status: 'ready',
      themes: [SHELL_THEME],
      installedShells: ['@danielng23/dsh-armory-client-ui-edex'],
    })
    expect(screen.getByRole('button', { name: 'Apply Armory' })).toBeDefined()
    expect(screen.queryByText(/^Full UI requires pnpm install/)).toBeNull()
  })

  it('shows a post-reload installed banner from the session marker and dismisses it', () => {
    window.sessionStorage.setItem('theme-store.last-install', JSON.stringify({
      id: 'armory', name: 'Armory', ts: new Date().toISOString(),
    }))
    mount({ status: 'ready', themes: [SHELL_THEME], installedShells: [] })
    expect(screen.getByRole('status').textContent).toContain('Armory')
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }))
    expect(screen.queryByRole('status')).toBeNull()
    expect(window.sessionStorage.getItem('theme-store.last-install')).toBeNull()
  })
})
