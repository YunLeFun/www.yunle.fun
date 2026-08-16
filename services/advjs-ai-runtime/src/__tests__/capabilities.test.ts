import type { CapabilityProjectContext } from '../capabilities/registry.js'
import { describe, expect, it } from 'vitest'
import { CapabilityOutputError, CapabilitySafetyError } from '../capabilities/errors.js'
import { createProjectProposalValidator } from '../capabilities/project-validator.js'
import { createServerCapabilityRegistry } from '../capabilities/server-registry.js'
import { AGENT_CAPABILITY_IDS } from '../contracts/v1.js'

const PROJECT: CapabilityProjectContext = {
  id: 'project_capability_fixture',
  revision: 'revision_capability_fixture',
  files: {
    'adv/world.md': '# 世界\n成年角色生活在虚构都市。',
    'adv/outline.md': '# 旧大纲\n',
    'adv/chapters/01.adv.md': '【车站，夜，外景】\n@hero\n我们出发。\n',
    'adv/characters/hero.character.md': '---\nid: hero\nname: Hero\n---\n',
    'private/secret.txt': 'must never enter a prompt',
  },
}

function requiredDefinition(id: typeof AGENT_CAPABILITY_IDS[number]) {
  const definition = createServerCapabilityRegistry().get(id)
  if (!definition)
    throw new Error(`Missing capability: ${id}`)
  return definition
}

describe('server authoring capability registry', () => {
  it('registers exactly five model capabilities with immutable execution policy', () => {
    const registry = createServerCapabilityRegistry()
    const definitions = AGENT_CAPABILITY_IDS.map(id => registry.get(id))

    expect(definitions.every(Boolean)).toBe(true)
    expect(definitions).toEqual(AGENT_CAPABILITY_IDS.map(id => expect.objectContaining({
      id,
      executor: 'model',
      promptVersion: `${id}-prompt-v1`,
      parserVersion: `${id}-parser-v1`,
      safetyVersion: 'authoring-safety-v1',
      executorVersion: 'model-executor-v1',
      maxOutputTokens: expect.any(Number),
      timeoutMs: expect.any(Number),
    })))
  })

  it('normalizes capability-specific input and retains only required project fragments', () => {
    const outline = requiredDefinition('generate-outline')
    const request = outline.normalizeRequest({ premise: '虚构成年人的冒险' }, PROJECT)

    expect(Object.keys(request.project.files).sort()).toEqual([
      'adv/characters/hero.character.md',
      'adv/outline.md',
      'adv/world.md',
    ])
    expect(outline.buildPrompt(request)).toMatchObject({
      system: expect.not.stringContaining('must never enter a prompt'),
      user: expect.not.stringContaining('must never enter a prompt'),
    })
    expect(() => outline.normalizeRequest({ premise: 'ok', systemPrompt: 'override' }, PROJECT)).toThrowError(/unknown field/i)
    expect(() => requiredDefinition('generate-chapter-draft').normalizeRequest({
      chapterPath: '../../secret',
    }, PROJECT)).toThrowError(/outside/i)
  })

  it('blocks explicit prohibited content without rejecting ordinary mature fiction', () => {
    const outline = requiredDefinition('generate-outline')
    const allowed = outline.normalizeRequest({ premise: '两名成年人的恋爱、战争与悲伤故事' }, PROJECT)
    const blocked = outline.normalizeRequest({ premise: '描写未成年人色情性行为' }, PROJECT)

    expect(() => outline.assertInputSafe(allowed)).not.toThrow()
    expect(() => outline.assertInputSafe(blocked)).toThrowError(CapabilitySafetyError)
    try {
      outline.assertInputSafe(blocked)
    }
    catch (error) {
      expect(error).toMatchObject({ code: 'CONTENT_BLOCKED_MINOR' })
    }
  })

  it('turns validated outline and chapter output into revision-bound proposals', async () => {
    const outline = requiredDefinition('generate-outline')
    const outlineRequest = outline.normalizeRequest({ premise: '成年角色冒险' }, PROJECT)
    const outlineCandidate = await outline.parseCandidate('# 故事大纲\n\n## 第一章\n启程。', outlineRequest)
    const chapter = requiredDefinition('generate-chapter-draft')
    const chapterRequest = chapter.normalizeRequest({ chapterPath: 'adv/chapters/01.adv.md' }, PROJECT)
    const chapterCandidate = await chapter.parseCandidate('【车站，夜，外景】\n@hero\n新的旅途开始。', chapterRequest)

    expect(outlineCandidate.proposal).toMatchObject({
      projectRevision: PROJECT.revision,
      patches: [{ kind: 'raw-text', path: 'adv/outline.md' }],
    })
    expect(chapterCandidate.proposal).toMatchObject({
      projectRevision: PROJECT.revision,
      patches: [{ kind: 'raw-text', path: 'adv/chapters/01.adv.md' }],
    })
  })

  it('strictly parses structured candidates for plot, roleplay and consistency review', async () => {
    const plot = requiredDefinition('suggest-plot')
    const plotRequest = plot.normalizeRequest({ chapterPath: 'adv/chapters/01.adv.md' }, PROJECT)
    const plotCandidate = await plot.parseCandidate(JSON.stringify({
      suggestions: [
        { label: 'A', synopsis: '向北', hook: '信件' },
        { label: 'B', synopsis: '向南', hook: '旧友' },
        { label: 'C', synopsis: '留下', hook: '暴雨' },
      ],
    }), plotRequest)
    const roleplay = requiredDefinition('simulate-roleplay')
    const roleplayRequest = roleplay.normalizeRequest({ characterIds: ['hero'], goal: '协商', rounds: 2 }, PROJECT)
    const roleplayCandidate = await roleplay.parseCandidate(JSON.stringify({
      lines: [{ speakerId: 'hero', speakerName: 'Hero', content: '我们谈谈。' }],
    }), roleplayRequest)
    const consistency = requiredDefinition('check-consistency')
    const consistencyRequest = consistency.normalizeRequest({ chapterPath: 'adv/chapters/01.adv.md' }, PROJECT)
    const consistencyCandidate = await consistency.parseCandidate(JSON.stringify({
      issues: [{ kind: 'timeline', severity: 'warn', title: '时间跳跃', detail: '夜晚突然变为清晨' }],
    }), consistencyRequest)

    expect(JSON.parse(plotCandidate.streamText).suggestions).toHaveLength(3)
    expect(JSON.parse(roleplayCandidate.streamText).lines).toHaveLength(1)
    expect(consistencyCandidate.proposal?.diagnostics).toMatchObject([{ code: 'timeline', severity: 'warning' }])
    await expect(plot.parseCandidate('{"suggestions":[]}', plotRequest)).rejects.toThrowError(CapabilityOutputError)
  })

  it('rejects traversal, baseline mismatch and parser-invalid project copies', async () => {
    const validator = createProjectProposalValidator()
    await expect(validator.validate({
      project: PROJECT,
      allowedWritePaths: ['../secret'],
      proposal: {
        summary: 'bad',
        projectRevision: PROJECT.revision,
        diagnostics: [],
        patches: [{ kind: 'raw-text', path: '../secret', content: 'bad' }],
      },
    })).rejects.toMatchObject({ code: 'PROJECT_VALIDATION_FAILED' })
    await expect(validator.validate({
      project: PROJECT,
      allowedWritePaths: ['adv/chapters/01.adv.md'],
      proposal: {
        summary: 'bad',
        projectRevision: 'stale-revision',
        diagnostics: [],
        patches: [{ kind: 'raw-text', path: 'adv/chapters/01.adv.md', content: '\0' }],
      },
    })).rejects.toMatchObject({ code: 'PROJECT_VALIDATION_FAILED' })
  })
})
