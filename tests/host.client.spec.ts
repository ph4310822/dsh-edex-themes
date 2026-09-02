// @vitest-environment node
/** Host half: registers the durable ui-theme-store settings namespace. */
import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { apply, THEME_STORE_NAMESPACE, ThemeStoreSettingsSchema } from '../src/index.ts'

describe('ui-theme-store host', () => {
  it('registers the durable settings namespace when the settings service exists', async () => {
    const ctx = new Context()
    const register = vi.fn()
    ctx.provide('settings', { register } as never)
    const fiber = ctx.plugin(apply)
    await fiber.await()
    expect(register).toHaveBeenCalledOnce()
    const [namespace, schema] = register.mock.calls[0]!
    expect(namespace).toBe(THEME_STORE_NAMESPACE)
    expect(schema.toJSON?.() ?? schema).toBeDefined()
    await fiber.dispose()
  })

  it('validates the schema and defaults the applied field to empty', () => {
    const value = ThemeStoreSettingsSchema({})
    expect(value.applied).toBe('')
    expect(ThemeStoreSettingsSchema({ applied: 'ocean' }).applied).toBe('ocean')
  })
})
