import { describe, expect, it } from 'vitest'
import { Config, independentSystemPromptFor, independentSystemPromptPartsFor, validateSettings } from '../src/index.js'
import type { ExpertRecord } from '../src/types.js'

const record: ExpertRecord = {
  id: 'startup-mentor', name: '创业导师', description: '创业战略与现金流', tags: ['创业', '现金流'], category: 'business',
  persona: '关注用户价值和现金流。', enabled: true,
}

describe('expert-ai configuration', () => {
  it('accepts a valid record', () => {
    expect(() => { validateSettings({ records: [record] }) }).not.toThrow()
  })

  it('accepts legacy tag records during migration', () => {
    const legacy = { ...record, description: '', tags: [], tag: '企业家' }
    expect(() => { validateSettings({ records: [legacy] }) }).not.toThrow()
  })
  it('accepts legacy custom records without customCategory', () => {
    expect(() => { validateSettings({ records: [{ ...record, category: 'custom', customCategory: undefined }] }) }).not.toThrow()
  })
  it('allows persona omission when an agent file is configured', () => {
    expect(() => { validateSettings({ records: [{ ...record, persona: '', agent: '~/.agent/agents/mentor.md' }] }) }).not.toThrow()
  })

  it('accepts records without an expert package after config parsing', () => {
    const records = Config({ records: [record] }).records.get()
    expect(records[0]?.expertPackage).toBeUndefined()
    expect(() => { validateSettings({ records }) }).not.toThrow()
  })

  it('accepts expert packages imported before the branch or tag was recorded', () => {
    const revision = 'a38f5fcad0853be3e98a6cd95d8e6bf8c66f7c7b'
    const legacy = {
      ...record, persona: '', agent: `.expert-packages/mimeographs/${revision}/steve-jobs/AGENTS.md`,
      expertPackage: { source: 'mimeographs', slug: 'steve-jobs', revision },
    }
    const records = Config({ records: [legacy] }).records.get()
    expect(() => { validateSettings({ records }) }).not.toThrow()
  })

  it('rejects duplicate and malformed ids', () => {
    expect(() => { validateSettings({ records: [record, record] }) }).toThrow(/duplicate id/)
    expect(() => { validateSettings({ records: [{ ...record, id: 'Bad ID' }] }) }).toThrow(/must match/)
  })

  it('rejects an empty persona', () => {
    expect(() => { validateSettings({ records: [{ ...record, persona: ' ' }] }) }).toThrow(/persona is required/)
  })

  it('still loads settings saved by removed features', () => {
    const legacy = {
      features: ['identity', 'conversation'], provider: 'spawn', maxBatchSize: 0,
      toolFilter: ['read_file'], model: { model: 'm' },
      teams: [{ id: 'Bad', name: ' ', analystIds: [], reviewerId: '' }], records: [record],
    }
    expect(Config(legacy).records.get()).toHaveLength(1)
    expect(() => { validateSettings(legacy) }).not.toThrow()
  })

  it('wraps the identity and localizes the domain in the conversation prompt', () => {
    const prompt = independentSystemPromptFor(record, '  身份正文  ')
    expect(prompt).toContain('身份正文')
    expect(prompt).toContain('主领域：企业')
    expect(prompt).not.toContain('business')
    expect(independentSystemPromptFor({ ...record, category: 'custom', customCategory: '' })).not.toContain('主领域')
  })

  it('keeps the identity file as a section of its own', () => {
    const parts = independentSystemPromptPartsFor(record, '  # AGENTS\n身份正文  ')
    expect(parts.persona).toBe('# AGENTS\n身份正文')
    expect(parts.pre).toContain(`# 专家：${record.name}`)
    expect(parts.pre).toContain('主领域：企业')
    expect(parts.pre).not.toContain('身份正文')
    expect(parts.suf).toContain('## 对话方式')
    expect(parts.suf).not.toContain('身份正文')
    expect(Object.keys(parts)).toEqual(['pre', 'persona', 'suf'])
    expect(independentSystemPromptFor(record, '  # AGENTS\n身份正文  ')).toBe([parts.pre, parts.persona, parts.suf].join('\n\n'))
  })

  it('asks the expert to stay in its own identity and to be honest about authorship', () => {
    const prompt = independentSystemPromptFor(record)

    expect(prompt).toContain('不要切换身份')
    expect(prompt).toContain('不要声称自己是真实人物本人')
    for (const removed of ['consult_expert', 'read_expert_reference', 'consult_expert_category', '@<团队ID>'])
      expect(prompt).not.toContain(removed)
  })
})

it('accepts an agent file instead of inline persona', () => {
  expect(() => {
    validateSettings({ records: [{ ...record, persona: '', agent: '~/.agent/agents/mentor.md' }] })
  }).not.toThrow()
})
