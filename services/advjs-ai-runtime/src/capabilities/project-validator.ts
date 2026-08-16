import type { AgentProjectPatch, AgentProposal } from '../contracts/v1.js'
import type { CapabilityProjectContext } from './registry.js'
import { Buffer } from 'node:buffer'
import { parseAst, parseCharacterMd } from '@advjs/parser'
import { CapabilityOutputError } from './errors.js'

const MAX_PATCHES = 8
const MAX_PATCH_BYTES = 256 * 1_024
const SAFE_PROJECT_PATH = /^adv\/(?:world\.md|outline\.md|chapters\/[\w.-]+\.adv\.md|characters\/[\w.-]+\.character\.md)$/

export interface ProjectProposalValidator {
  validate: (input: {
    project: CapabilityProjectContext
    proposal: AgentProposal
    allowedWritePaths: readonly string[]
  }) => Promise<void>
}

function fail(message: string): never {
  throw new CapabilityOutputError('PROJECT_VALIDATION_FAILED', message)
}

function assertSafePath(path: string): void {
  if (!SAFE_PROJECT_PATH.test(path) || path.startsWith('/') || path.includes('..') || path.includes('\\'))
    fail('Proposal path is outside the ADV.JS project boundary')
}

function applyRawPatch(files: Record<string, string>, patch: AgentProjectPatch): void {
  if (patch.kind !== 'raw-text')
    fail('The managed authoring capabilities only accept raw text patches')
  if (Buffer.byteLength(patch.content) > MAX_PATCH_BYTES)
    fail('Proposal patch is too large')
  files[patch.path] = patch.content
}

async function parseProjectCopy(files: Readonly<Record<string, string>>): Promise<void> {
  for (const [path, content] of Object.entries(files)) {
    if (content.includes('\0'))
      fail('Project content contains an invalid null byte')
    try {
      if (path.endsWith('.adv.md')) {
        if (!content.trim())
          fail('Chapter candidate is empty')
        await parseAst(content)
      }
      else if (path.endsWith('.character.md')) {
        parseCharacterMd(content)
      }
    }
    catch (error) {
      if (error instanceof CapabilityOutputError)
        throw error
      fail(`ADV.JS parser rejected ${path}`)
    }
  }
}

export function createProjectProposalValidator(): ProjectProposalValidator {
  return {
    async validate(input): Promise<void> {
      if (input.proposal.projectRevision !== input.project.revision)
        fail('Proposal project revision does not match the request baseline')
      if (input.proposal.patches.length > MAX_PATCHES)
        fail('Proposal contains too many patches')
      const allowed = new Set(input.allowedWritePaths)
      const copy = { ...input.project.files }
      for (const patch of input.proposal.patches) {
        assertSafePath(patch.path)
        if (!allowed.has(patch.path))
          fail('Proposal path is not writable by this capability')
        applyRawPatch(copy, patch)
      }
      await parseProjectCopy(copy)
    },
  }
}
