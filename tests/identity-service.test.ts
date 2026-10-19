import { createHash } from 'node:crypto'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { disclosureFor, ExpertIdentityProvider } from '../src/index.js'
import type { ExpertIdentityService } from '../src/index.js'
import type { DigitalLifeRecord } from '../src/types.js'

const mentor: DigitalLifeRecord = {
  id: 'mentor', name: '创业导师', description: '创业与现金流', tags: ['创业', '现金流'], category: 'business',
  persona: '关注现金流。', enabled: true,
}
const analyst: DigitalLifeRecord = {
  id: 'analyst', name: '储能专家', description: '储能系统', tags: ['储能'], category: 'tech',
  persona: '关注系统可靠性。', enabled: true,
}
const png = { mime: 'image/png' as const, data: 'iVBORw0KGgo=' }

const sha256 = (text: string): string => createHash('sha256').update(text, 'utf8').digest('hex')

interface Harness {
  ctx: Context
  root: string
  /** The service as another plugin receives it, through cordis' proxy. */
  service: ExpertIdentityService
  records: DigitalLifeRecord[]
  changes: string[][]
}

const cleanups: Array<() => Promise<void>> = []
afterEach(async () => {
  await Promise.all(cleanups.splice(0).map((cleanup) => cleanup()))
})

async function start(records: DigitalLifeRecord[]): Promise<Harness> {
  const root = await mkdtemp(join(tmpdir(), 'expert-identity-'))
  const ctx = new Context()
  cleanups.push(async () => {
    await ctx.fiber.dispose()
    await rm(root, { recursive: true, force: true })
  })
  const harness = { ctx, root, records, changes: [] } as unknown as Harness
  ctx.on('expert-identity/changed', ({ ids }) => { harness.changes.push(ids) })
  await ctx.plugin((inner: Context) => {
    new ExpertIdentityProvider(inner, { saved: () => harness.records, records: () => harness.records, stateDir: () => root })
  })
  await ctx.plugin(Object.assign((inner: Context) => { harness.service = inner.expertIdentity }, { inject: ['expertIdentity'] }))
  await harness.service.list()
  return harness
}

/** Replace the records as a settings write does, then wait until the service has caught up. */
async function update(harness: Harness, records: DigitalLifeRecord[]): Promise<void> {
  harness.records = records
  harness.ctx.emit('loader/volatile-update', [['records']])
  await harness.service.list()
}

describe('expertIdentity service', () => {
  it('lists only enabled identities, in settings order, without persona text', async () => {
    const h = await start([mentor, { ...analyst, enabled: false }, { ...mentor, id: 'writer', name: '写作者' }])
    const list = await h.service.list()
    expect(list.map((item) => item.id)).toEqual(['mentor', 'writer'])
    for (const item of list) {
      expect(item.enabled).toBe(true)
      expect(item).not.toHaveProperty('persona')
      expect(item).not.toHaveProperty('disclosure')
    }
  })

  it('returns the whole identity for an enabled id', async () => {
    const h = await start([mentor])
    const identity = await h.service.get('mentor')
    expect(identity).toEqual({
      id: 'mentor', name: '创业导师', title: '思考助手', description: '创业与现金流', category: '企业',
      tags: ['创业', '现金流'], source: { kind: 'public' }, revision: sha256('关注现金流。'), enabled: true,
      persona: '关注现金流。', disclosure: disclosureFor('public'),
    })
    expect(identity).not.toHaveProperty('avatar')
  })

  it('returns undefined, not an error, for an unknown or disabled id', async () => {
    const h = await start([mentor, { ...analyst, enabled: false }])
    await expect(h.service.get('nobody')).resolves.toBeUndefined()
    await expect(h.service.get('analyst')).resolves.toBeUndefined()
    await expect(h.service.get('')).resolves.toBeUndefined()
  })

  it('derives the revision from the persona only', async () => {
    const h = await start([mentor])
    const first = await h.service.get('mentor')
    expect(first?.revision).toBe(sha256('关注现金流。'))
    await update(h, [{ ...mentor, title: '创业思考助手', description: '换了简介' }])
    expect((await h.service.get('mentor'))?.revision).toBe(first?.revision)
    await update(h, [{ ...mentor, persona: '关注团队。' }])
    const changed = await h.service.get('mentor')
    expect(changed?.persona).toBe('关注团队。')
    expect(changed?.revision).toBe(sha256('关注团队。'))
    expect(changed?.revision).not.toBe(first?.revision)
  })

  it('waits for a settings write in flight before answering', async () => {
    const h = await start([mentor])
    h.records = [{ ...mentor, persona: '刚改过的人设。' }]
    h.ctx.emit('loader/volatile-update', [['records']])
    expect((await h.service.get('mentor'))?.persona).toBe('刚改过的人设。')
  })

  it('publishes title, category, avatar, and source as the record defines them', async () => {
    const h = await start([
      { ...mentor, title: '  创业思考助手  ', avatar: png, source: { kind: 'organization', note: ' 内部访谈 ' } },
      { ...analyst, category: 'custom', customCategory: '新能源' },
    ])
    const [first, second] = await h.service.list()
    expect(first).toMatchObject({ title: '创业思考助手', category: '企业', avatar: png, source: { kind: 'organization', note: '内部访谈' } })
    expect(second).toMatchObject({ title: '思考助手', category: '新能源' })
  })

  it('does not publish an avatar the Bot runtime would reject', async () => {
    const gif = { mime: 'image/gif', data: png.data } as unknown as DigitalLifeRecord['avatar']
    const h = await start([{ ...mentor, avatar: gif }])
    expect(await h.service.get('mentor')).not.toHaveProperty('avatar')
  })

  it('omits an identity whose persona cannot be read and keeps the others', async () => {
    const h = await start([mentor, { ...analyst, agent: join('/nonexistent-expert-identity', 'missing.md') }])
    expect((await h.service.list()).map((item) => item.id)).toEqual(['mentor'])
    await expect(h.service.get('analyst')).resolves.toBeUndefined()
  })
})

describe('disclosure', () => {
  it('follows the source kind and defaults to public', async () => {
    const h = await start([
      mentor,
      { ...mentor, id: 'org', source: { kind: 'organization' } },
      { ...mentor, id: 'auth', source: { kind: 'authorized' } },
    ])
    const texts = await Promise.all(['mentor', 'org', 'auth'].map(async (id) => (await h.service.get(id))?.disclosure))
    expect(texts).toEqual([disclosureFor('public'), disclosureFor('organization'), disclosureFor('authorized')])
    expect(new Set(texts).size).toBe(3)
  })

  it('states what each origin means', () => {
    expect(disclosureFor('public')).toMatch(/公开资料.*并非本人/)
    expect(disclosureFor('organization')).toMatch(/组织内部资料.*并非本人/)
    expect(disclosureFor('authorized')).toContain('经本人授权')
    expect(disclosureFor('authorized')).not.toContain('并非本人')
  })

  it('keeps the free-text note out of the disclosure', async () => {
    const h = await start([{ ...mentor, source: { kind: 'organization', note: '内部访谈纪要第七期' } }])
    const identity = await h.service.get('mentor')
    expect(identity?.source.note).toBe('内部访谈纪要第七期')
    expect(identity?.disclosure).not.toContain('内部访谈纪要第七期')
  })

  it('treats an unknown kind as public', async () => {
    const h = await start([{ ...mentor, source: { kind: 'sponsored' } as never }])
    const identity = await h.service.get('mentor')
    expect(identity?.source).toEqual({ kind: 'public' })
    expect(identity?.disclosure).toBe(disclosureFor('public'))
  })
})

describe('expert-identity/changed', () => {
  it('stays quiet at startup', async () => {
    const h = await start([mentor, analyst])
    expect(h.changes).toEqual([])
  })

  it('names the identity whose persona changed', async () => {
    const h = await start([mentor, analyst])
    await update(h, [{ ...mentor, persona: '关注团队。' }, analyst])
    expect(h.changes).toEqual([['mentor']])
  })

  it('names identities that were added, removed, disabled, and enabled again', async () => {
    const h = await start([mentor])
    await update(h, [mentor, analyst])
    await update(h, [analyst])
    await update(h, [{ ...analyst, enabled: false }])
    await update(h, [analyst])
    expect(h.changes).toEqual([['analyst'], ['mentor'], ['analyst'], ['analyst']])
  })

  it('lists several changed ids once, sorted', async () => {
    const h = await start([mentor, analyst])
    await update(h, [{ ...mentor, persona: '甲' }, { ...analyst, persona: '乙' }, { ...mentor, id: 'aaa', name: '新人' }])
    expect(h.changes).toEqual([['aaa', 'analyst', 'mentor']])
  })

  it('reports a change to anything published, even when the revision stays', async () => {
    const h = await start([mentor])
    await update(h, [{ ...mentor, title: '创业思考助手' }])
    await update(h, [{ ...mentor, title: '创业思考助手', avatar: png }])
    await update(h, [{ ...mentor, title: '创业思考助手', avatar: png, source: { kind: 'authorized' } }])
    expect(h.changes).toEqual([['mentor'], ['mentor'], ['mentor']])
  })

  it('stays quiet when nothing that is published changed', async () => {
    const h = await start([mentor])
    await update(h, [mentor])
    await update(h, [{ ...mentor, toolFilter: ['read_file'] }])
    expect(h.changes).toEqual([])
  })

  it('lets a listener read the new identity', async () => {
    const h = await start([mentor])
    const seen: Array<string | undefined> = []
    h.ctx.on('expert-identity/changed', async ({ ids }) => {
      seen.push((await h.service.get(ids[0] ?? ''))?.persona)
    })
    await update(h, [{ ...mentor, persona: '关注团队。' }])
    await vi.waitFor(() => { expect(seen).toEqual(['关注团队。']) })
  })

  it('keeps publishing after a listener throws', async () => {
    const h = await start([mentor])
    const off = h.ctx.on('expert-identity/changed', () => { throw new Error('listener failed') })
    await update(h, [{ ...mentor, persona: '关注团队。' }])
    expect((await h.service.get('mentor'))?.persona).toBe('关注团队。')
    off()
    await update(h, [{ ...mentor, persona: '关注增长。' }])
    expect(h.changes).toEqual([['mentor'], ['mentor']])
  })

  it('publishes an identity once its persona becomes readable', async () => {
    const h = await start([mentor])
    const file = join(h.root, 'late.md')
    const late = { ...analyst, agent: file }
    await update(h, [mentor, late])
    expect(h.changes).toEqual([])
    await writeFile(file, '---\nname: analyst\n---\n\n后来才写好的人设。\n')
    await update(h, [mentor, late])
    expect(h.changes).toEqual([['analyst']])
    expect((await h.service.get('analyst'))?.persona).toBe('后来才写好的人设。')
  })
})
