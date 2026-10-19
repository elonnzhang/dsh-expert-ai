import { mkdtemp, readFile, rm, writeFile, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { agentDocument, agentIdentity, agentPath, createProject, digitalLifeHome, identityFor, initializeIdentities, managedAgentBinding, reconcileIdentities } from '../src/host/identity.js'
import type { DigitalLifeRecord } from '../src/types.js'

const record: DigitalLifeRecord = {
  id: 'mentor', name: '导师', description: '创业与管理', tags: ['创业', '现金流'], category: 'business',
  persona: '关注现金流。', enabled: true,
}
const homes: string[] = []
afterEach(async () => {
  vi.unstubAllEnvs()
  await Promise.all(homes.splice(0).map(path => rm(path, { recursive: true, force: true })))
})

async function home(): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), 'digital-life-'))
  homes.push(path)
  vi.stubEnv('DSH_HOME', path)
  return path
}

describe('digital-life expert agent identity', () => {
  it('does not append digital-life twice when stateDir already names the data directory', async () => {
    const root = await home()
    expect(digitalLifeHome(process.env, join(root, 'digital-life'))).toBe(join(root, 'digital-life'))
  })

  it('creates isolated project directories under the digital-life home', async () => {
    const root = await home()
    const first = await createProject()
    const second = await createProject()
    expect(first).toMatch(new RegExp(`^${root.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/digital-life/projects/`))
    expect(second).not.toBe(first)
  })

  it('renders compatible YAML frontmatter', () => {
    expect(agentDocument(record, record.persona)).toContain('name: \"mentor\"')
    expect(agentDocument(record, record.persona)).toContain('model: \"inherit\"\n---')
  })

  it('strips agent frontmatter', () => {
    expect(agentIdentity('---\nname: mentor\ndescription: test\n---\n\n# Identity\nBe concise.\n'))
      .toBe('# Identity\nBe concise.')
  })

  it('creates and reads one durable agents/<id>.md per record', async () => {
    await home()
    await initializeIdentities([record])
    expect(await readFile(agentPath(record.id), 'utf8')).toContain('name: \"mentor\"')
    expect(await readFile(agentPath(record.id), 'utf8')).toContain('关注现金流。')
    expect(await identityFor({ ...record, persona: 'settings changed only' })).toBe('关注现金流。')
  })

  it('persists a managed agent binding and uses its markdown as the source', async () => {
    await home()
    const managed = { ...record, agent: managedAgentBinding(record.id) }
    await reconcileIdentities([], [managed])
    expect(await readFile(agentPath(record.id), 'utf8')).toContain('关注现金流。')
    expect(await identityFor({ ...managed, persona: 'stale settings text' })).toBe('关注现金流。')
  })

  it('uses an external agent file as the sole identity source', async () => {
    const root = await home()
    const source = join(root, 'agents', 'mentor.md')
    await mkdir(join(root, 'agents'), { recursive: true })
    await writeFile(source, '---\nname: mentor\n---\nUse first principles.\n')
    const imported = { ...record, persona: '', agent: source }
    await reconcileIdentities([], [imported])
    await expect(readFile(agentPath(record.id))).rejects.toMatchObject({ code: 'ENOENT' })
    expect(await identityFor(imported)).toBe('Use first principles.')
    await reconcileIdentities([imported], [{ ...imported, persona: 'Must not overwrite external source.' }])
    expect(await identityFor(imported)).toBe('Use first principles.')
    await reconcileIdentities([imported], [])
    expect(await readFile(source, 'utf8')).toContain('Use first principles.')
  })

  it('reports each stored change even when another record cannot be stored', async () => {
    await home()
    const gone = { ...record, id: 'gone' }
    const broken = { ...record, id: 'broken', agent: join('/nonexistent-expert-identity', 'missing.md') }
    await initializeIdentities([record, gone])
    const applied: Array<[string, string | undefined]> = []
    await expect(
      reconcileIdentities([record, gone], [{ ...record, persona: '关注团队。' }, broken], undefined, (id, stored) => {
        applied.push([id, stored?.persona])
      }),
    ).rejects.toThrow('cannot load agent')
    expect(applied.sort()).toEqual([['gone', undefined], ['mentor', '关注团队。']])
    await expect(readFile(agentPath('gone'))).rejects.toMatchObject({ code: 'ENOENT' })
    expect(await readFile(agentPath('mentor'), 'utf8')).toContain('关注团队。')
  })
})
