import { describe, expect, it } from 'vitest'
import { Config, validateSettings } from '../src/index.js'
import {
  EXPERT_SOURCE_KINDS,
  MAX_EXPERT_AVATAR_LENGTH,
  MAX_EXPERT_SOURCE_NOTE_LENGTH,
  MAX_EXPERT_TITLE_LENGTH,
} from '../src/constants.js'
import type { ExpertRecord } from '../src/types.js'

const record: ExpertRecord = {
  id: 'zhang', name: '张剑辉', description: '储能系统', tags: ['储能'], category: 'tech',
  persona: '关注系统可靠性。', enabled: true,
}
const png = { mime: 'image/png' as const, data: 'iVBORw0KGgo=' }

function messageOf(patch: Record<string, unknown>): string {
  try {
    validateSettings({ records: [{ ...record, ...patch } as ExpertRecord] })
  } catch (error) {
    return (error as Error).message
  }
  return ''
}

describe('record title, avatar and source', () => {
  it('keeps records written before these fields existed valid', () => {
    const parsed = Config({ records: [record] }).records.get()[0]
    expect(parsed?.title).toBeUndefined()
    expect(parsed?.avatar).toBeUndefined()
    expect(parsed?.source).toBeUndefined()
    expect(messageOf({})).toBe('')
  })

  it('parses title, avatar and source from settings', () => {
    const parsed = Config({
      records: [{ ...record, title: '储能系统思考助手', avatar: png, source: { kind: 'organization', note: '内部访谈' } }],
    }).records.get()[0]
    expect(parsed).toMatchObject({ title: '储能系统思考助手', avatar: png, source: { kind: 'organization', note: '内部访谈' } })
  })

  it('accepts every source kind, with or without a note', () => {
    for (const kind of EXPERT_SOURCE_KINDS) {
      expect(messageOf({ source: { kind } })).toBe('')
      expect(messageOf({ source: { kind, note: '访谈整理' } })).toBe('')
    }
  })

  it('rejects an unknown source kind', () => {
    expect(messageOf({ source: { kind: 'secret' } })).toMatch(/source kind must be one of public, organization, authorized for "zhang"/)
    expect(() => Config({ records: [{ ...record, source: { kind: 'secret' } } as unknown as ExpertRecord] })).toThrow()
  })

  it('limits the title to the trimmed length', () => {
    expect(messageOf({ title: 'x'.repeat(MAX_EXPERT_TITLE_LENGTH) })).toBe('')
    expect(messageOf({ title: `  ${'x'.repeat(MAX_EXPERT_TITLE_LENGTH)}  ` })).toBe('')
    expect(messageOf({ title: 'x'.repeat(MAX_EXPERT_TITLE_LENGTH + 1) })).toMatch(/title must contain at most 40 characters for "zhang"/)
  })

  it('limits the source note', () => {
    expect(messageOf({ source: { kind: 'public', note: 'x'.repeat(MAX_EXPERT_SOURCE_NOTE_LENGTH) } })).toBe('')
    expect(messageOf({ source: { kind: 'public', note: 'x'.repeat(MAX_EXPERT_SOURCE_NOTE_LENGTH + 1) } })).toMatch(
      /source note must contain at most 200 characters for "zhang"/,
    )
  })

  it('treats a blank title and a blank note as absent', () => {
    expect(messageOf({ title: '   ', source: { kind: 'public', note: '  ' } })).toBe('')
  })

  it('measures the note after trimming', () => {
    expect(messageOf({ source: { kind: 'public', note: `  ${'x'.repeat(MAX_EXPERT_SOURCE_NOTE_LENGTH)}  ` } })).toBe('')
  })

  it('reads an empty `source:` or `avatar:` in YAML as absent', () => {
    const [parsed] = Config({ records: [{ ...record, source: null, avatar: null }] as never }).records.get()
    expect(() => validateSettings({ records: [parsed as ExpertRecord] })).not.toThrow()
    expect(messageOf({ source: null, avatar: null })).toBe('')
  })

  it('refuses to load an avatar of another image type', () => {
    const gif = { ...record, avatar: { mime: 'image/gif', data: png.data } } as unknown as ExpertRecord
    expect(() => Config({ records: [gif] })).toThrow()
  })

  it('rejects avatars the Bot runtime would not store', () => {
    expect(messageOf({ avatar: png })).toBe('')
    expect(messageOf({ avatar: { mime: 'image/gif', data: png.data } })).toMatch(/avatar: image type must be one of/)
    expect(messageOf({ avatar: { mime: 'image/png', data: 'not base64' } })).toMatch(/avatar: image data must be base64 for "zhang"/)
    expect(messageOf({ avatar: { mime: 'image/png', data: 'A'.repeat(MAX_EXPERT_AVATAR_LENGTH) } })).toMatch(
      /avatar: image must fit in 160000 characters as a data URL for "zhang"/,
    )
  })

  it('never echoes the image in an error', () => {
    const message = messageOf({ avatar: { mime: 'image/png', data: 'A'.repeat(MAX_EXPERT_AVATAR_LENGTH) } })
    expect(message).not.toContain('AAAA')
    expect(messageOf({ avatar: { mime: 'image/png', data: 'secret image bytes' } })).not.toContain('secret image bytes')
  })
})
