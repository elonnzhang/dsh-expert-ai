import { mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { agentPath, initializeIdentities, reconcileIdentities } from '../src/host/identity.js'
import type { DigitalLifeRecord } from '../src/types.js'

const disk = vi.hoisted(() => ({ full: false, stuck: false }))

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>()
  const writeFile = (async (...args: Parameters<typeof actual.writeFile>) => {
    if (!disk.full) return actual.writeFile(...args)
    await actual.writeFile(args[0], String(args[1]).slice(0, 4), args[2])
    throw Object.assign(new Error('no space left on device'), { code: 'ENOSPC' })
  }) as typeof actual.writeFile
  const rm = (async (...args: Parameters<typeof actual.rm>) => {
    if (disk.stuck) throw Object.assign(new Error('operation not permitted'), { code: 'EPERM' })
    return actual.rm(...args)
  }) as typeof actual.rm
  return { ...actual, writeFile, rm }
})

const record: DigitalLifeRecord = {
  id: 'mentor', name: '导师', description: '创业与管理', tags: ['创业'], category: 'business',
  persona: '关注现金流。', enabled: true,
}
const edited = { ...record, persona: '关注团队。' }

const dirs: string[] = []
afterEach(async () => {
  disk.full = false
  disk.stuck = false
  await Promise.all(dirs.splice(0).map((path) => rm(path, { recursive: true, force: true })))
})

async function stateDir(): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), 'identity-atomic-'))
  dirs.push(path)
  return path
}

describe('managed identity files are replaced atomically', () => {
  it('keeps the previous persona and leaves no temporary file when a save runs out of space', async () => {
    const dir = await stateDir()
    await initializeIdentities([record], dir)
    const path = agentPath('mentor', dir)
    const before = await readFile(path, 'utf8')
    disk.full = true
    await expect(reconcileIdentities([record], [edited], dir)).rejects.toMatchObject({ code: 'ENOSPC' })
    disk.full = false
    expect(await readFile(path, 'utf8')).toBe(before)
    expect(await readdir(dirname(path))).toEqual(['mentor.md'])
  })

  it('creates a new identity file only once its content is complete', async () => {
    const dir = await stateDir()
    disk.full = true
    await expect(initializeIdentities([record], dir)).rejects.toMatchObject({ code: 'ENOSPC' })
    disk.full = false
    await expect(readFile(agentPath('mentor', dir))).rejects.toMatchObject({ code: 'ENOENT' })
    expect(await readdir(dirname(agentPath('mentor', dir)))).toEqual([])
  })

  it('keeps the legacy file and creates no identity file when the migration cannot be saved', async () => {
    const dir = await stateDir()
    const path = agentPath('mentor', dir)
    const legacy = join(dirname(dirname(path)), 'AGENTS.md')
    await mkdir(dirname(legacy), { recursive: true })
    await writeFile(legacy, '旧版人设。')
    disk.full = true
    await expect(initializeIdentities([record], dir)).rejects.toMatchObject({ code: 'ENOSPC' })
    disk.full = false
    expect(await readFile(legacy, 'utf8')).toBe('旧版人设。')
    await expect(readFile(path)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('migrates the legacy file into a complete identity file', async () => {
    const dir = await stateDir()
    const path = agentPath('mentor', dir)
    const legacy = join(dirname(dirname(path)), 'AGENTS.md')
    await mkdir(dirname(legacy), { recursive: true })
    await writeFile(legacy, '旧版人设。')
    await initializeIdentities([record], dir)
    expect(await readFile(path, 'utf8')).toContain('旧版人设。')
    await expect(readFile(legacy)).rejects.toMatchObject({ code: 'ENOENT' })
    expect(await readdir(dirname(path))).toEqual(['mentor.md'])
  })

  it.skipIf(process.platform === 'win32')('keeps the file private after a rewrite', async () => {
    const dir = await stateDir()
    await initializeIdentities([record], dir)
    await reconcileIdentities([record], [edited], dir)
    expect((await stat(agentPath('mentor', dir))).mode & 0o777).toBe(0o600)
  })

  it('saves an identity whose id nearly fills a file name', async () => {
    const dir = await stateDir()
    const long = { ...record, id: 'a'.repeat(230) }
    await initializeIdentities([long], dir)
    expect(await readFile(agentPath(long.id, dir), 'utf8')).toContain('关注现金流。')
    await reconcileIdentities([long], [{ ...long, persona: '关注团队。' }], dir)
    expect(await readFile(agentPath(long.id, dir), 'utf8')).toContain('关注团队。')
  })

  it('reports the failed save, not the failed removal of its temporary file', async () => {
    const dir = await stateDir()
    await initializeIdentities([record], dir)
    disk.full = true
    disk.stuck = true
    await expect(reconcileIdentities([record], [edited], dir)).rejects.toMatchObject({ code: 'ENOSPC' })
  })
})
