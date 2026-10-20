import { describe, expect, it } from 'vitest'
import { Config, DEFAULT_TEAM_PERSONA, independentSystemPromptFor, independentSystemPromptPartsFor, promptFor, teamSystemPromptPartsFor, validateSettings } from '../src/index.js'
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

  it('rejects empty persona and invalid batch size', () => {
    expect(() => { validateSettings({ records: [{ ...record, persona: ' ' }] }) }).toThrow(/persona is required/)
    expect(() => { validateSettings({ maxBatchSize: 0, records: [] }) }).toThrow(/must be positive/)
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
    expect(text).toContain('不要调用 consult_digital_life')
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
    expect(parts.pre).toContain(`# 数字生命：${record.name}`)
    expect(parts.pre).toContain('主领域：企业')
    expect(parts.pre).not.toContain('身份正文')
    expect(parts.suf).toContain('## 对话方式')
    expect(parts.suf).toContain('## 协作')
    expect(parts.suf).not.toContain('身份正文')
    expect(independentSystemPromptFor(record, '  # AGENTS\n身份正文  ')).toBe([parts.pre, parts.persona, parts.suf].join('\n\n'))
  })

  it('routes mentions of other digital lives through consultation tools', () => {
    const prompt = independentSystemPromptFor(record)

    expect(prompt).toContain('@<数字生命ID>')
    expect(prompt).toContain('必须调用 consult_digital_life')
    expect(prompt).toContain(`@${record.id}`)
    expect(prompt).toContain('调用 consult_digital_life_category')
    expect(prompt).toContain('@<团队ID>')
    expect(prompt).toContain('start_team_run')
    expect(prompt).toContain('amend_team_brief')
  })
})

it('accepts an agent file instead of inline persona', () => {
  expect(() => {
    validateSettings({ records: [{ ...record, persona: '', agent: '~/.agent/agents/mentor.md' }] })
  }).not.toThrow()
})

describe('expert teams', () => {
  const team = { id: 'plan-review', name: '方案评审', purpose: '', analystIds: ['a', 'b'], reviewerId: 'c' }

  it('parses teams with defaults and accepts a valid lineup', () => {
    const teams = Config({ teams: [{ id: 't', name: 'T', analystIds: ['a'], reviewerId: 'b' }] }).teams.get()
    expect(teams[0]).toMatchObject({ purpose: '', analystIds: ['a'], reviewerId: 'b' })
    expect(Config({}).teams.get()).toEqual([])
    expect(() => { validateSettings({ teams: [team] }) }).not.toThrow()
  })

  it('does not require team members to exist as records', () => {
    expect(() => { validateSettings({ records: [], teams: [team] }) }).not.toThrow()
  })

  it('rejects malformed team ids, names and duplicates', () => {
    expect(() => { validateSettings({ teams: [{ ...team, id: 'Bad' }] }) }).toThrow(/team id/)
    expect(() => { validateSettings({ teams: [team, team] }) }).toThrow(/duplicate team id/)
    expect(() => { validateSettings({ teams: [{ ...team, name: ' ' }] }) }).toThrow(/team name/)
  })

  it('enforces 1-3 unique analysts and a separate reviewer', () => {
    expect(() => { validateSettings({ teams: [{ ...team, analystIds: [] }] }) }).toThrow(/1-3 unique/)
    expect(() => { validateSettings({ teams: [{ ...team, analystIds: ['a', 'b', 'd', 'e'] }] }) }).toThrow(/1-3 unique/)
    expect(() => { validateSettings({ teams: [{ ...team, analystIds: ['a', 'a'] }] }) }).toThrow(/1-3 unique/)
    expect(() => { validateSettings({ teams: [{ ...team, reviewerId: 'a' }] }) }).toThrow(/reviewer/)
    expect(() => { validateSettings({ teams: [{ ...team, reviewerId: '' }] }) }).toThrow(/reviewer/)
  })

  it('accepts a coordinator and member responsibilities', () => {
    const parsed = Config({ teams: [{ ...team, coordinatorId: 'd', responsibilities: { a: '统计方法' } }] }).teams.get()
    expect(parsed[0]).toMatchObject({ coordinatorId: 'd', responsibilities: { a: '统计方法' } })
    expect(Config({ teams: [team] }).teams.get()[0]?.coordinatorId).toBeUndefined()
    expect(() => { validateSettings({ teams: [{ ...team, coordinatorId: 'd', responsibilities: { a: '统计', d: '拆解目标' } }] }) }).not.toThrow()
  })

  it('rejects responsibilities for non-members or of invalid length', () => {
    expect(() => { validateSettings({ teams: [{ ...team, responsibilities: { x: '统计' } }] }) }).toThrow(/responsibility/)
    expect(() => { validateSettings({ teams: [{ ...team, responsibilities: { a: ' ' } }] }) }).toThrow(/1-200/)
    expect(() => { validateSettings({ teams: [{ ...team, responsibilities: { a: 'x'.repeat(201) } }] }) }).toThrow(/1-200/)
    expect(() => { validateSettings({ teams: [{ ...team, coordinatorId: ' ' }] }) }).toThrow(/coordinator/)
  })

  it('accepts a team persona of 1-8000 characters', () => {
    expect(Config({ teams: [{ ...team, persona: '主持人' }] }).teams.get()[0]?.persona).toBe('主持人')
    expect(Config({ teams: [team] }).teams.get()[0]?.persona).toBeUndefined()
    expect(() => { validateSettings({ teams: [{ ...team, persona: ' ' }] }) }).toThrow(/persona/)
    expect(() => { validateSettings({ teams: [{ ...team, persona: 'x'.repeat(8_001) }] }) }).toThrow(/persona/)
  })

  it('hosts a team session with the team persona, not a member persona', () => {
    const members = ['a', 'b', 'c'].map((id) => ({ id, name: `Name ${id}`, description: id, category: 'science' as const, tags: [], persona: `Member ${id}`, enabled: true }))
    const parts = teamSystemPromptPartsFor({ ...team, persona: '  团队主持人  ', responsibilities: { a: '统计' } }, members)
    expect(parts.persona).toBe('团队主持人')
    expect(parts.pre).toContain('# 专家团：方案评审（@plan-review）')
    expect(parts.pre).toContain('- 分析：Name a（@a） — 统计')
    expect(parts.pre).toContain('- 审查与汇总：Name c（@c）')
    expect(parts.suf).toContain('teamId "plan-review"')
    expect(`${parts.pre}${parts.persona}${parts.suf}`).not.toMatch(/Member [abc]/)
    expect(teamSystemPromptPartsFor(team, members).persona).toBe(DEFAULT_TEAM_PERSONA)
    const adhoc = teamSystemPromptPartsFor({ name: '临时专家团', analystIds: ['a'], reviewerId: 'c' }, members)
    expect(adhoc.pre).toContain('临时组队')
    expect(adhoc.suf).toContain('analystIds ["a"] 和 reviewerId "c"')
  })
})
