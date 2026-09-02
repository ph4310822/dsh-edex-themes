/**
 * Minimal fake ThemeRuntime for standalone tests. The published
 * `@deepseek-ai/dsh-client-ui-theme/client` bundle is closure-factory loader
 * format and cannot be imported in Node. This fake mirrors the contract
 * surface ThemeStoreRuntime consumes: `getTheme()`, `setTheme()`, `register()`,
 * and `theme/change` event emission on the cordis context.
 */
import type { Context } from '@deepseek-ai/cordis'

/** Built-in theme ids that the harness always provides. */
const BUILTINS = ['light', 'dark'] as const

/** Minimal theme definition shape. */
export interface FakeThemeDef {
  id: string
  colorScheme: 'light' | 'dark'
  tokens: Record<string, string>
}

/** Minimal theme snapshot shape. */
export interface FakeThemeSnapshot {
  preference: string
  active: FakeThemeDef
  themes: readonly FakeThemeDef[]
  revision: number
}

/** Fake ThemeRuntime that ThemeStoreRuntime can consume (getTheme/setTheme/register + theme/change). */
export class FakeThemeRuntime {
  private themes: FakeThemeDef[] = [
    { id: 'light', colorScheme: 'light', tokens: {} },
    { id: 'dark', colorScheme: 'dark', tokens: {} },
  ]
  private preference = 'system'
  private revision = 0
  private readonly disposers = new Map<string, () => void>()

  constructor(private readonly ctx: Context) {}

  /** Build and return the current snapshot. */
  getTheme(): FakeThemeSnapshot {
    const resolved = this.preference === 'system'
      ? 'light'
      : this.preference === 'light' || this.preference === 'dark'
        ? this.preference
        : this.preference
    const active = this.themes.find(t => t.id === resolved)!
    return {
      preference: this.preference,
      active,
      themes: [...this.themes],
      revision: this.revision,
    }
  }

  /** Switch the active preference. */
  setTheme(id: string): void {
    if (id !== 'system' && !this.themes.some(t => t.id === id)) {
      throw new Error(`theme "${id}" is not registered`)
    }
    if (this.preference === id) return
    this.preference = id
    this.revision++
    this.ctx.emit('theme/change', this.getTheme())
  }

  /** Register a theme. Returns a disposer. */
  register(def: FakeThemeDef): () => void {
    if (this.themes.some(t => t.id === def.id)) {
      throw new Error(`theme "${def.id}" is already registered`)
    }
    if (def.id === 'system') throw new Error('"system" is a preference, not a registrable theme id')
    this.themes = [...this.themes, def]
    this.revision++
    this.ctx.emit('theme/change', this.getTheme())
    const dispose = () => {
      if (!this.themes.some(t => t.id === def.id)) return
      this.themes = this.themes.filter(t => t.id !== def.id)
      if (this.preference === def.id) {
        this.preference = 'system'
      }
      this.revision++
      this.ctx.emit('theme/change', this.getTheme())
    }
    this.disposers.set(def.id, dispose)
    return dispose
  }
}