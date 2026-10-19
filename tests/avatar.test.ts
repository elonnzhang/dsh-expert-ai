import { describe, expect, it } from 'vitest'
import { avatarDataUrl, avatarFromDataUrl, avatarProblem } from '../src/avatar.js'
import { EXPERT_AVATAR_MIMES, MAX_EXPERT_AVATAR_LENGTH } from '../src/constants.js'
import type { ExpertIdentityAvatar } from '../src/types.js'

const PNG = 'iVBORw0KGgo='
const avatar: ExpertIdentityAvatar = { mime: 'image/png', data: PNG }

function withMime(mime: string, data = PNG): ExpertIdentityAvatar {
  return { mime, data } as unknown as ExpertIdentityAvatar
}

describe('expert avatar', () => {
  it('builds the data URL the Bot runtime stores', () => {
    expect(avatarDataUrl(avatar)).toBe(`data:image/png;base64,${PNG}`)
  })

  it('accepts every allowed image type', () => {
    for (const mime of EXPERT_AVATAR_MIMES) expect(avatarProblem({ mime, data: PNG })).toBeUndefined()
  })

  it('rejects other image types', () => {
    for (const mime of ['image/gif', 'image/svg+xml', 'text/html', ''])
      expect(avatarProblem(withMime(mime))).toMatch(/image type/)
  })

  it('rejects data that is not base64', () => {
    for (const data of ['', 'abc', 'a b c d', 'A===', '=AAA', `data:image/png;base64,${PNG}`])
      expect(avatarProblem({ mime: 'image/png', data })).toBe('image data must be base64')
  })

  it('accepts the longest data URL and rejects the next base64 group', () => {
    const room = MAX_EXPERT_AVATAR_LENGTH - avatarDataUrl({ mime: 'image/png', data: '' }).length
    const fit = room - (room % 4)
    expect(avatarProblem({ mime: 'image/png', data: 'A'.repeat(fit) })).toBeUndefined()
    expect(avatarProblem({ mime: 'image/png', data: 'A'.repeat(fit + 4) })).toMatch(/must fit in 160000 characters/)
  })

  it('counts the data URL prefix against the limit', () => {
    const png = avatarDataUrl({ mime: 'image/png', data: '' }).length
    const webp = avatarDataUrl({ mime: 'image/webp', data: '' }).length
    expect(webp).toBeGreaterThan(png)
    const data = 'A'.repeat(MAX_EXPERT_AVATAR_LENGTH - webp - ((MAX_EXPERT_AVATAR_LENGTH - webp) % 4))
    expect(avatarProblem({ mime: 'image/webp', data })).toBeUndefined()
  })

  it('never puts the image in the problem text', () => {
    const problem = avatarProblem({ mime: 'image/png', data: 'A'.repeat(MAX_EXPERT_AVATAR_LENGTH) })
    expect(problem).toBeDefined()
    expect(problem).not.toContain('AAAA')
    expect(avatarProblem({ mime: 'image/png', data: 'not base64 data' })).not.toContain('not base64 data')
  })

  it('accepts every base64 character and both padding forms', () => {
    for (const data of ['A+/B'.repeat(10), 'Zm9v', 'AAAAAA==', 'AAAAAAA='])
      expect(avatarProblem({ mime: 'image/png', data })).toBeUndefined()
  })

  it('splits a data URL back into an avatar', () => {
    expect(avatarFromDataUrl(`data:image/png;base64,${PNG}`)).toEqual(avatar)
    expect(avatarFromDataUrl(avatarDataUrl({ mime: 'image/webp', data: PNG }))).toEqual({ mime: 'image/webp', data: PNG })
  })

  it('refuses data URLs the identity layer would not store', () => {
    const urls = [
      '',
      'https://example.com/a.png',
      'data:image/png,abc',
      `data:image/gif;base64,${PNG}`,
      `image/png;base64,${PNG}`,
      'data:image/png;base64,',
      'data:image/png;base64,not base64',
      `data:image/png;base64,${'A'.repeat(MAX_EXPERT_AVATAR_LENGTH)}`,
    ]
    for (const url of urls) expect(avatarFromDataUrl(url)).toBeUndefined()
  })

  it('refuses a URL that only looks like a data URL', () => {
    for (const url of [`blob:image/png;base64,${PNG}`, `data:image/pngX;base64,${PNG}`])
      expect(avatarFromDataUrl(url)).toBeUndefined()
  })
})
