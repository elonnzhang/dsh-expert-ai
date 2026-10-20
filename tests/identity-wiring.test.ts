import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import { afterEach, describe, expect, it } from 'vitest'
import { agentPath } from '../src/host/identity.js'
import * as plugin from '../src/index.js'
import type { ExpertIdentity, ExpertIdentitySummary } from '../src/index.js'
import { fakeHostConnection } from './host-connection.js'

const cleanups: Array<() => Promise<void>> = []
afterEach(async () => {
  await Promise.all(cleanups.splice(0).map((cleanup) => cleanup()))
})

describe('expertIdentity in the loaded plugin', () => {
  it('serves the normalized records to another plugin', async () => {
    const root = await mkdtemp(join(tmpdir(), 'expert-identity-wiring-'))
    const ctx = new Context()
    cleanups.push(async () => {
      await ctx.fiber.dispose()
      await rm(root, { recursive: true, force: true })
    })
    await ctx.plugin(SystemPrompt, {})
    await ctx.plugin(ToolRuntime)
    ctx.provide('subagents', {})
    ctx.provide('agents', {})
    ctx.provide('connection', fakeHostConnection().connection)
    ctx.provide('sandboxPolicy', { defaultMode: 'read-only' })
    await ctx.plugin(plugin, {
      stateDir: root,
      records: [
        {
          id: 'mentor', name: ' 创业导师 ', title: ' 创业思考助手 ', description: '创业', category: 'business',
          persona: '关注现金流。', source: { kind: 'organization', note: ' 访谈 ' },
        },
        { id: 'hidden', name: '停用', description: '停用', category: 'science', persona: '不应出现。', enabled: false },
      ],
    })
    const seen = await new Promise<{ list: ExpertIdentitySummary[]; mentor: ExpertIdentity | undefined }>((resolve, reject) => {
      void ctx.plugin(Object.assign((inner: Context) => {
        const { expertIdentity } = inner
        Promise.all([expertIdentity.list(), expertIdentity.get('mentor')]).then(([list, mentor]) => { resolve({ list, mentor }) }, reject)
      }, { inject: ['expertIdentity'] }))
    })
    expect(seen.list.map((item) => item.id)).toEqual(['mentor'])
    expect(seen.mentor).toMatchObject({
      name: '创业导师', title: '创业思考助手', category: '企业', persona: '关注现金流。', source: { kind: 'organization', note: '访谈' },
    })
    expect(await readFile(agentPath('mentor', root), 'utf8')).toContain('关注现金流。')
    expect(await readFile(agentPath('hidden', root), 'utf8')).toContain('不应出现。')
  })
})
