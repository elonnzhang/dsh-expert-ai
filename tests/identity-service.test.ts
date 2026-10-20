import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DIGITAL_LIFE_CATEGORY_LABELS, EXPERT_SOURCE_KINDS } from '../src/constants.js'
import { agentPath } from '../src/host/identity.js'
import { disclosureFor, ExpertIdentityProvider } from '../src/index.js'
import type { ExpertIdentityChange, ExpertIdentityService } from '../src/index.js'
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

function xingtuRecords(): DigitalLifeRecord[] {
  const patch = readFileSync(resolve(import.meta.dirname, '..', 'cordis.patch.yml'), 'utf8')
  return patch
    .split(/^ {10}- id: /m)
    .slice(1)
    .filter((block) => block.includes('agent: experts/xingtu/'))
    .map((block) => {
      const id = block.slice(0, block.indexOf('\n'))
      const field = (name: string): string => new RegExp(`^ {12}${name}: (.+)$`, 'm').exec(block)?.[1]?.trim() ?? ''
      return {
        id,
        name: field('name'),
        title: field('title'),
        description: field('description'),
        category: 'science',
        tags: [],
        persona: '',
        agent: field('agent'),
        enabled: true,
      }
    })
}

interface Harness {
  ctx: Context
  root: string
  /** State directory the service is told to use; a test may point it elsewhere between writes. */
  dir: string
  /** The service as another plugin receives it, through cordis' proxy. */
  service: ExpertIdentityService
  records: DigitalLifeRecord[]
  changes: string[][]
  /** Every payload of `expert-identity/changed`, as the listener received it. */
  events: ExpertIdentityChange[]
}

const cleanups: Array<() => Promise<void>> = []
afterEach(async () => {
  await Promise.all(cleanups.splice(0).map((cleanup) => cleanup()))
})

/** `before` runs ahead of the recorder, so a listener it adds is called first; `dirFor` picks the state directory. */
async function start(
  records: DigitalLifeRecord[],
  before?: (ctx: Context) => void,
  dirFor?: (root: string) => Promise<string>,
): Promise<Harness> {
  const root = await mkdtemp(join(tmpdir(), 'expert-identity-'))
  const ctx = new Context()
  cleanups.push(async () => {
    await ctx.fiber.dispose()
    await rm(root, { recursive: true, force: true })
  })
  const dir = dirFor === undefined ? root : await dirFor(root)
  const harness = { ctx, root, dir, records, changes: [], events: [] } as unknown as Harness
  before?.(ctx)
  ctx.on('expert-identity/changed', (change) => {
    harness.changes.push(change.ids)
    harness.events.push(change)
  })
  await ctx.plugin((inner: Context) => {
    new ExpertIdentityProvider(inner, { saved: () => harness.records, records: () => harness.records, stateDir: () => harness.dir })
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

  it('lists all nine bundled Xingtu identities in a fresh state directory', async () => {
    const records = xingtuRecords()
    const h = await start(records)
    const listed = await h.service.list()
    expect(listed.map((item) => item.id)).toEqual(records.map((record) => record.id))
    expect(await h.service.get('clq')).toMatchObject({ id: 'clq', name: '陈立泉', title: '固态电池与科研方法思考助手' })
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

  it.each([
    ['business', '企业'],
    ['science', '科学'],
    ['tech', '技术'],
    ['culture', '文化'],
    ['entertainment', '娱乐'],
  ] as const)('publishes the %s domain as %s', async (category, label) => {
    const h = await start([{ ...mentor, category }])
    expect((await h.service.list())[0]?.category).toBe(label)
    expect(DIGITAL_LIFE_CATEGORY_LABELS[category]).toBe(label)
  })

  it('hands out copies, so a consumer cannot change the settings', async () => {
    const h = await start([{ ...mentor, tags: ['创业', '现金流'], avatar: { ...png } }])
    const first = await h.service.get('mentor')
    first?.tags.push('篡改')
    if (first?.avatar !== undefined) first.avatar.data = 'AAAA'
    const again = await h.service.get('mentor')
    expect(again?.tags).toEqual(['创业', '现金流'])
    expect(again?.avatar).toEqual(png)
    expect(h.records[0]?.tags).toEqual(['创业', '现金流'])
    expect(h.records[0]?.avatar).toEqual(png)
  })

  it('writes the managed file under the state directory in force at each write', async () => {
    const h = await start([mentor])
    expect(await readFile(agentPath('mentor', h.root), 'utf8')).toContain('关注现金流。')
    const other = await mkdtemp(join(tmpdir(), 'expert-identity-other-'))
    cleanups.push(() => rm(other, { recursive: true, force: true }))
    h.dir = other
    await update(h, [mentor, analyst])
    expect(await readFile(agentPath('analyst', other), 'utf8')).toContain('关注系统可靠性。')
    await expect(readFile(agentPath('analyst', h.root), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('keeps editor-managed identities published when the state directory changes', async () => {
    const managed = { ...mentor, agent: 'mentor/agents/mentor.md' }
    const h = await start([managed])
    const other = await mkdtemp(join(tmpdir(), 'expert-identity-other-'))
    cleanups.push(() => rm(other, { recursive: true, force: true }))
    h.dir = other
    await update(h, [managed])
    expect((await h.service.list()).map(({ id }) => id)).toEqual(['mentor'])
    expect((await h.service.get('mentor'))?.persona).toBe('关注现金流。')
    expect(await readFile(agentPath('mentor', other), 'utf8')).toContain('关注现金流。')
    expect(h.changes).toEqual([])
  })

  it('seeds a new state directory again on a later save when the first attempt failed', async () => {
    const managed = { ...mentor, agent: 'mentor/agents/mentor.md' }
    const h = await start([managed])
    const blocked = join(h.root, 'blocked')
    await writeFile(blocked, 'not a directory')
    h.dir = blocked
    await update(h, [managed])
    expect(await h.service.get('mentor')).toBeUndefined()
    await rm(blocked)
    await mkdir(blocked)
    await update(h, [managed])
    expect((await h.service.get('mentor'))?.persona).toBe('关注现金流。')
    expect(await readFile(agentPath('mentor', blocked), 'utf8')).toContain('关注现金流。')
    expect(h.changes).toEqual([['mentor'], ['mentor']])
  })

  it('seeds the state directory on a later save when the attempt at startup failed', async () => {
    const managed = { ...mentor, agent: 'mentor/agents/mentor.md' }
    const h = await start([managed], undefined, async (root) => {
      const blocked = join(root, 'blocked')
      await writeFile(blocked, 'not a directory')
      return blocked
    })
    expect(await h.service.get('mentor')).toBeUndefined()
    await rm(h.dir)
    await mkdir(h.dir)
    await update(h, [managed])
    expect((await h.service.get('mentor'))?.persona).toBe('关注现金流。')
    expect(await readFile(agentPath('mentor', h.dir), 'utf8')).toContain('关注现金流。')
    expect(h.changes).toEqual([['mentor']])
  })

  it('retries a save that failed when the settings are written again', async () => {
    const managed = { ...mentor, agent: 'mentor/agents/mentor.md' }
    const h = await start([managed])
    const file = agentPath('mentor', h.root)
    await rm(file)
    await mkdir(file)
    const edited = [{ ...managed, persona: '关注团队。' }]
    await update(h, edited)
    expect(await h.service.get('mentor')).toBeUndefined()
    await rm(file, { recursive: true })
    await update(h, edited)
    expect((await h.service.get('mentor'))?.persona).toBe('关注团队。')
    expect(h.changes).toEqual([['mentor'], ['mentor']])
  })

  it('keeps saving personas after the state directory changes while another record cannot be read', async () => {
    const managed = { ...mentor, agent: 'mentor/agents/mentor.md' }
    const broken = { ...analyst, agent: join('/nonexistent-expert-identity', 'missing.md') }
    const h = await start([managed, broken])
    const other = await mkdtemp(join(tmpdir(), 'expert-identity-other-'))
    cleanups.push(() => rm(other, { recursive: true, force: true }))
    h.dir = other
    await update(h, [managed, broken])
    await update(h, [{ ...managed, persona: '第一次修改。' }, broken])
    await update(h, [{ ...managed, persona: '第二次修改。' }, broken])
    expect((await h.service.get('mentor'))?.persona).toBe('第二次修改。')
    expect(await readFile(agentPath('mentor', other), 'utf8')).toContain('第二次修改。')
    expect(h.changes).toEqual([['mentor'], ['mentor']])
  })

  it('applies a revert after an earlier write only partly succeeded', async () => {
    const broken = { ...analyst, agent: join('/nonexistent-expert-identity', 'missing.md') }
    const h = await start([mentor])
    await update(h, [{ ...mentor, persona: '关注团队。' }, broken])
    expect((await h.service.get('mentor'))?.persona).toBe('关注团队。')
    await update(h, [mentor])
    expect((await h.service.get('mentor'))?.persona).toBe('关注现金流。')
    expect(await readFile(agentPath('mentor', h.root), 'utf8')).toContain('关注现金流。')
    expect(h.events).toStrictEqual([{ ids: ['mentor'] }, { ids: ['analyst', 'mentor'], withdrawn: ['analyst'] }])
  })

  it('stores a record again when a partly failed write had removed it', async () => {
    const managed = { ...mentor, agent: 'mentor/agents/mentor.md' }
    const broken = { ...analyst, agent: join('/nonexistent-expert-identity', 'missing.md') }
    const h = await start([managed])
    await update(h, [broken])
    await expect(h.service.get('mentor')).resolves.toBeUndefined()
    await update(h, [managed])
    expect((await h.service.get('mentor'))?.persona).toBe('关注现金流。')
    expect(await readFile(agentPath('mentor', h.root), 'utf8')).toContain('关注现金流。')
  })

  it('removes the storage of a record that a partly failed write had added', async () => {
    const broken = { ...analyst, id: 'broken', agent: join('/nonexistent-expert-identity', 'missing.md') }
    const h = await start([mentor])
    await update(h, [mentor, analyst, broken])
    expect(await readFile(agentPath('analyst', h.root), 'utf8')).toContain('关注系统可靠性。')
    await update(h, [mentor])
    await expect(readFile(agentPath('analyst', h.root), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('publishes tags trimmed and without duplicates', async () => {
    const h = await start([{ ...mentor, tags: [' 创业 ', '创业', '现金流'] }])
    expect((await h.service.list())[0]?.tags).toEqual(['创业', '现金流'])
    expect((await h.service.get('mentor'))?.tags).toEqual(['创业', '现金流'])
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

  it('tells the persona to admit what it is and not to invent beyond its sources', () => {
    for (const kind of EXPERT_SOURCE_KINDS) {
      expect(disclosureFor(kind)).toContain('如实说明')
      expect(disclosureFor(kind)).toMatch(/不要.*编造/)
    }
    for (const kind of ['public', 'organization'] as const)
      expect(disclosureFor(kind)).toContain('不要声称自己就是本人')
    expect(disclosureFor('authorized')).toContain('不是本人在实时回答')
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

  it.each([
    ['name', { name: '新名字' }],
    ['description', { description: '换了简介' }],
    ['category', { category: 'tech' }],
    ['tags', { tags: ['创业', '增长'] }],
  ])('reports a change to the %s', async (_field, patch) => {
    const h = await start([mentor])
    await update(h, [{ ...mentor, ...patch } as DigitalLifeRecord])
    expect(h.changes).toEqual([['mentor']])
  })

  it('announces a change once, not again on the next unrelated write', async () => {
    const h = await start([mentor, analyst])
    const edited = { ...mentor, persona: '关注团队。' }
    await update(h, [edited, analyst])
    await update(h, [edited, { ...analyst, toolFilter: ['read_file'] }])
    expect(h.changes).toEqual([['mentor']])
  })

  it('serves the persona saved last after an edit and its reversal', async () => {
    const h = await start([mentor])
    await update(h, [{ ...mentor, persona: '关注团队。' }])
    await update(h, [mentor])
    expect((await h.service.get('mentor'))?.persona).toBe('关注现金流。')
    const file = await readFile(agentPath('mentor', h.root), 'utf8')
    expect(file).toContain('关注现金流。')
    expect(file).not.toContain('关注团队。')
    expect(h.changes).toEqual([['mentor'], ['mentor']])
  })

  it('still announces an edit when another record in the same write cannot be stored', async () => {
    const h = await start([mentor])
    await update(h, [{ ...mentor, persona: '关注团队。' }, { ...analyst, persona: '' }])
    expect((await h.service.get('mentor'))?.persona).toBe('关注团队。')
    expect(h.changes).toEqual([['mentor']])
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

  it('tells every listener even when one added earlier throws, and logs only who failed', async () => {
    const warnings: unknown[] = []
    const h = await start([mentor], (ctx) => {
      ctx.logger.exporter({
        levels: { default: 3 },
        export: (message) => { if (message.type === 'warn') warnings.push(...message.args) },
      })
      ctx.on('expert-identity/changed', () => { throw new TypeError('关注团队。') })
    })
    await update(h, [{ ...mentor, persona: '关注团队。' }])
    expect(h.changes).toEqual([['mentor']])
    await vi.waitFor(() => { expect(warnings.join('\n')).toContain('expert-identity/changed') })
    expect(warnings.every((arg) => typeof arg === 'string')).toBe(true)
    expect(warnings.join('\n')).toContain('mentor')
    expect(warnings.join('\n')).toContain('TypeError')
    expect(warnings.join('\n')).not.toContain('关注团队。')
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

describe('withdrawn identities', () => {
  it('lists a disabled identity as withdrawn, and not again when it is enabled', async () => {
    const h = await start([mentor, analyst])
    await update(h, [mentor, { ...analyst, enabled: false }])
    await update(h, [mentor, analyst])
    expect(h.events).toStrictEqual([{ ids: ['analyst'], withdrawn: ['analyst'] }, { ids: ['analyst'] }])
  })

  it('lists a deleted identity as withdrawn', async () => {
    const h = await start([mentor, analyst])
    await update(h, [mentor])
    expect(h.events).toStrictEqual([{ ids: ['analyst'], withdrawn: ['analyst'] }])
  })

  it('leaves withdrawn out when nothing was disabled or deleted', async () => {
    const h = await start([mentor])
    await update(h, [{ ...mentor, persona: '关注团队。' }, analyst])
    expect(h.events).toStrictEqual([{ ids: ['analyst', 'mentor'] }])
  })

  it('lists withdrawn ids sorted, next to ids that only changed', async () => {
    const zed = { ...analyst, id: 'zed', name: '末位' }
    const h = await start([mentor, zed, analyst])
    await update(h, [{ ...mentor, persona: '关注团队。' }, { ...zed, enabled: false }])
    expect(h.events).toStrictEqual([{ ids: ['analyst', 'mentor', 'zed'], withdrawn: ['analyst', 'zed'] }])
  })

  it('does not call an identity withdrawn when its persona stops being readable', async () => {
    const h = await start([mentor])
    const file = join(h.root, 'late.md')
    const late = { ...analyst, agent: file }
    await writeFile(file, '---\nname: analyst\n---\n\n外部人设。\n')
    await update(h, [mentor, late])
    await rm(file)
    await update(h, [mentor, late])
    expect(h.events).toStrictEqual([{ ids: ['analyst'] }, { ids: ['analyst'] }])
  })

  it('lists a record deleted while its persona could not be read as withdrawn', async () => {
    const h = await start([mentor])
    await update(h, [mentor, { ...analyst, agent: join(h.root, 'never-written.md') }])
    await update(h, [mentor])
    expect(h.events).toStrictEqual([{ ids: ['analyst'], withdrawn: ['analyst'] }])
  })

  it('announces a withdrawal once, not when the disabled record is deleted later', async () => {
    const h = await start([mentor, analyst])
    await update(h, [mentor, { ...analyst, enabled: false }])
    await update(h, [mentor, { ...analyst, enabled: false, description: '换了简介' }])
    await update(h, [mentor])
    expect(h.events).toStrictEqual([{ ids: ['analyst'], withdrawn: ['analyst'] }])
  })

  it('has stopped serving a withdrawn identity by the time listeners hear of it', async () => {
    const h = await start([mentor, analyst])
    const seen: Array<string | undefined> = []
    h.ctx.on('expert-identity/changed', async ({ withdrawn }) => {
      for (const id of withdrawn ?? []) seen.push((await h.service.get(id))?.persona)
    })
    await update(h, [mentor, { ...analyst, enabled: false }])
    await vi.waitFor(() => { expect(seen).toEqual([undefined]) })
  })
})

