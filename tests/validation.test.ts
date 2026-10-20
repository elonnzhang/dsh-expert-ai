import { describe, expect, it } from 'vitest'
import { Config, independentSystemPromptFor, independentSystemPromptPartsFor, promptFor, validateSettings } from '../src/index.js'
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

  it('still loads settings saved with the removed team and batch-size fields', () => {
    const legacy = { maxBatchSize: 0, teams: [{ id: 'Bad', name: ' ', analystIds: [], reviewerId: '' }], records: [record] }
    expect(Config(legacy).records.get()).toHaveLength(1)
    expect(() => { validateSettings(legacy) }).not.toThrow()
  })

  it('builds a focused consultation prompt without repeating the persona', () => {
    const prompt = promptFor(record, '下一步做什么？')[0]
    expect(prompt).toMatchObject({ type: 'text' })
    const text = prompt.type === 'text' ? prompt.text : ''
    expect(text).toContain('创业导师')
    expect(text).toContain('主领域：企业')
    expect(text).toContain('简介：创业战略与现金流')
    expect(text).toContain('<question>\n下一步做什么？\n</question>')
    expect(text).not.toContain(record.persona)
    expect(text).toContain('不要调用 consult_expert')
  })

  it('wraps the identity and localizes the domain in the session prompt', () => {
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
    expect(parts.suf).toContain('## 协作')
    expect(parts.suf).not.toContain('身份正文')
    expect(independentSystemPromptFor(record, '  # AGENTS\n身份正文  ')).toBe([parts.pre, parts.persona, parts.suf].join('\n\n'))
  })

  it('routes mentions of other experts through consult_expert only', () => {
    const prompt = independentSystemPromptFor(record)

    expect(prompt).toContain('@<专家ID>')
    expect(prompt).toContain('必须调用 consult_expert')
    expect(prompt).toContain(`@${record.id}`)
    for (const removed of ['consult_expert_category', '@<团队ID>', 'start_team_run', 'amend_team_brief', 'review_expert_plan'])
      expect(prompt).not.toContain(removed)
    expect(promptFor(record, '?')[0]).not.toMatchObject({ text: expect.stringContaining('consult_expert_category') })
  })
})

it('accepts an agent file instead of inline persona', () => {
  expect(() => {
    validateSettings({ records: [{ ...record, persona: '', agent: '~/.agent/agents/mentor.md' }] })
  }).not.toThrow()
})
