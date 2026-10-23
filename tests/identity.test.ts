import { mkdtemp, readFile, rm, writeFile, mkdir } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { join, relative } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { agentDocument, agentIdentity, agentPath, createProject, expertAiHome, identityFor, importMimeograph, initializeIdentities, packageRootFrom, recordForPackage, reconcileIdentities } from '../src/host/identity/index.js'
import { managedAgentPath, normalizeRecord } from '../src/record-model.js'
import type { CanonicalExpertRecord } from '../src/types.js'
import { packageBinding, packageFetcher } from './expert-fixture.js'

const record = normalizeRecord({
  id: 'mentor', name: '导师', description: '创业与管理', tags: ['创业', '现金流'], category: 'business',
  persona: '关注现金流。', enabled: true,
})
const homes: string[] = []
afterEach(async () => {
  vi.unstubAllEnvs()
  await Promise.all(homes.splice(0).map(path => rm(path, { recursive: true, force: true })))
})

async function home(): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), 'expert-ai-'))
  homes.push(path)
  vi.stubEnv('DSH_HOME', path)
  return path
}

describe('expert agent identity', () => {
  it('stores data in $DSH_HOME/expert-ai', async () => {
    const root = await home()
    expect(expertAiHome()).toBe(join(root, 'expert-ai'))
  })

  it('keeps Harness directories separate when DSH_HOME ends in expert-ai', async () => {
    const root = join(await home(), 'expert-ai')
    vi.stubEnv('DSH_HOME', root)
    expect(expertAiHome()).toBe(join(root, 'expert-ai'))
    expect(expertAiHome(process.env, '  ')).toBe(join(root, 'expert-ai'))
    const profileFile = join(root, 'profiles', 'web', 'marker.txt')
    await mkdir(join(root, 'profiles', 'web'), { recursive: true })
    await writeFile(profileFile, 'Harness profile')
    const profileRecord = { ...record, id: 'profiles' }
    await initializeIdentities([profileRecord])
    await reconcileIdentities([profileRecord], [])
    expect(await readFile(profileFile, 'utf8')).toBe('Harness profile')
    await expect(readFile(agentPath('profiles'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('does not append expert-ai twice when stateDir already names the data directory', async () => {
    const root = await home()
    expect(expertAiHome(process.env, join(root, 'expert-ai'))).toBe(join(root, 'expert-ai'))
  })

  it('treats any stateDir without the expert-ai suffix as the parent', async () => {
    const root = await home()
    expect(expertAiHome(process.env, join(root, 'state'))).toBe(join(root, 'state', 'expert-ai'))
    expect(expertAiHome(process.env, join(root, 'other-plugin'))).toBe(join(root, 'other-plugin', 'expert-ai'))
  })

  it('creates isolated project directories under the expert-ai home', async () => {
    const root = await home()
    const first = await createProject()
    const second = await createProject()
    expect(first).toMatch(new RegExp(`^${root.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/expert-ai/projects/`))
    expect(second).not.toBe(first)
  })

  it('renders compatible YAML frontmatter', () => {
    const document = agentDocument(record, record.persona)
    expect(document.startsWith('---\n')).toBe(true)
    expect(document).toContain('name: \"mentor\"')
    expect(document.endsWith(`---\n\n${record.persona.trim()}\n`)).toBe(true)
  })

  it('strips agent frontmatter', () => {
    expect(agentIdentity('---\nname: mentor\ndescription: test\n---\n\n# Identity\nBe concise.\n'))
      .toBe('# Identity\nBe concise.')
  })

  it('uses a state-relative file before the plugin fallback for file origins', async () => {
    const root = await home()
    const relative = 'experts/xingtu/clq/AGENTS.md'
    const local = join(root, 'expert-ai', relative)
    await mkdir(join(root, 'expert-ai', 'experts', 'xingtu', 'clq'), { recursive: true })
    await writeFile(local, '# Local override\n')
    expect(await identityFor({ ...record, origin: { kind: 'file', path: relative } })).toBe('# Local override')
  })

  it('falls back to the plugin package for a missing relative file origin', async () => {
    const root = await home()
    const identity = await identityFor({ ...record, origin: { kind: 'file', path: 'experts/xingtu/clq/AGENTS.md' } }, root)
    expect(identity).toContain('# 陈立泉 · 科学家数字分身')
  })

  it('reads bundled origins only from the plugin package', async () => {
    const root = await home()
    const directory = join(expertAiHome(), 'experts', 'xingtu', 'clq')
    await mkdir(directory, { recursive: true })
    await writeFile(join(directory, 'AGENTS.md'), '# Local override\n')
    await writeFile(join(directory, 'manifest.json'), '{}')
    const bundled = normalizeRecord({ ...record, origin: { kind: 'bundled', path: 'experts/xingtu/clq' } })
    await initializeIdentities([bundled], root)
    expect(await identityFor(bundled, root)).toContain('# 陈立泉 · 科学家数字分身')
    expect(await readFile(join(directory, 'AGENTS.md'), 'utf8')).toBe('# Local override\n')
  })

  it('does not retry absolute or home-relative paths inside the package', async () => {
    await home()
    for (const path of ['/nonexistent-expert-identity/missing.md', '~/nonexistent-expert-identity/missing.md'])
      await expect(identityFor({ ...record, origin: { kind: 'file', path } })).rejects.toThrow('ENOENT')
  })

  it('expands a home-relative file origin and strips its frontmatter', async () => {
    const root = await home()
    const file = join(root, 'identity.md')
    await writeFile(file, '\uFEFF---\r\nname: mentor\r\n---\r\n\r\n# Home identity\r\n')
    const path = `~/${relative(homedir(), file)}`
    expect(await identityFor({ ...record, origin: { kind: 'file', path } })).toBe('# Home identity')
  })

  it('does not retry a relative path when reading fails for a reason other than ENOENT', async () => {
    const root = await home()
    const directory = join(root, 'expert-ai', 'experts', 'xingtu', 'clq', 'AGENTS.md')
    await mkdir(directory, { recursive: true })
    await expect(identityFor({ ...record, origin: { kind: 'file', path: 'experts/xingtu/clq/AGENTS.md' } })).rejects.toThrow('EISDIR')
  })

  it('finds the nearest package root', async () => {
    const root = await mkdtemp(join(tmpdir(), 'expert-ai-package-root-'))
    homes.push(root)
    await mkdir(join(root, 'outer', 'inner'), { recursive: true })
    await writeFile(join(root, 'package.json'), '{}')
    await writeFile(join(root, 'outer', 'package.json'), '{}')
    expect(packageRootFrom(join(root, 'outer', 'inner', 'src'))).toBe(join(root, 'outer'))
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
    const managed = normalizeRecord({ ...record, origin: undefined, agent: managedAgentPath(record.id) })
    await reconcileIdentities([], [managed])
    expect(await readFile(agentPath(record.id), 'utf8')).toContain('关注现金流。')
    expect(await identityFor({ ...managed, persona: 'stale settings text' })).toBe('关注现金流。')
  })

  it('uses an external agent file as the sole identity source', async () => {
    const root = await home()
    const source = join(root, 'agents', 'mentor.md')
    await mkdir(join(root, 'agents'), { recursive: true })
    await writeFile(source, '---\nname: mentor\n---\nUse first principles.\n')
    const imported = normalizeRecord({ ...record, origin: { kind: 'file', path: source } })
    await reconcileIdentities([], [imported])
    await expect(readFile(agentPath(record.id))).rejects.toMatchObject({ code: 'ENOENT' })
    expect(await identityFor(imported)).toBe('Use first principles.')
    await reconcileIdentities([imported], [{ ...imported, persona: 'Must not overwrite external source.' }])
    expect(await identityFor(imported)).toBe('Use first principles.')
    await reconcileIdentities([imported], [])
    expect(await readFile(source, 'utf8')).toContain('Use first principles.')
  })

  it('uses the legacy inline persona only when the managed file is absent', async () => {
    await home()
    expect(await identityFor(record)).toBe(record.persona)
    await initializeIdentities([record])
    expect(await identityFor({ ...record, persona: '' })).toBe(record.persona)
    await expect(identityFor({ ...record, id: 'missing', persona: '' })).rejects.toThrow('no identity configured')
  })

  it('reads an imported package origin without creating a managed file', async () => {
    const root = await home()
    const imported = recordForPackage(await importMimeograph(packageBinding, root, packageFetcher()), 'main')
    await initializeIdentities([imported], root)
    expect(await identityFor(imported, root)).toContain('Separate evidence')
    await expect(readFile(agentPath(imported.id, root))).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('leaves id storage intact when deleting file, bundled, and package records', async () => {
    const root = await home()
    const file = join(root, 'outside.md')
    await writeFile(file, 'External identity.')
    const imported = recordForPackage(await importMimeograph(packageBinding, root, packageFetcher()), 'main')
    const records: CanonicalExpertRecord[] = [
      normalizeRecord({ ...record, id: 'external', origin: { kind: 'file', path: file } }),
      normalizeRecord({ ...record, id: 'bundled', origin: { kind: 'bundled', path: 'experts/xingtu/clq' } }),
      imported,
    ]
    for (const item of records) {
      const directory = join(expertAiHome(), item.id)
      await mkdir(directory, { recursive: true })
      await writeFile(join(directory, 'marker'), 'Keep me.')
    }
    const applied: string[] = []
    await reconcileIdentities(records, [], undefined, (id) => { applied.push(id) })
    expect(applied.sort()).toEqual(records.map(({ id }) => id).sort())
    for (const item of records)
      expect(await readFile(join(expertAiHome(), item.id, 'marker'), 'utf8')).toBe('Keep me.')
    expect(await identityFor(imported, root)).toContain('Separate evidence')
  })

  it('reports each stored change even when another record cannot be stored', async () => {
    await home()
    const gone = { ...record, id: 'gone' }
    const broken = normalizeRecord({ ...record, id: 'broken', origin: { kind: 'file', path: join('/nonexistent-expert-identity', 'missing.md') } })
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
