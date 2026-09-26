/**
 * Language-wide lexical settings: `fileMatchers`, `lineComment`,
 * `blockComment`, `stringDelimiters` (plan §5.1). A Rule Set needs them, and
 * every rule is tested with the masking they define (contract §6.3), so they
 * are settled before any construct.
 *
 * The model reads the general Skill files (those that introduce no construct)
 * and proposes the settings. The runner decides: every marker and every
 * literal part of every glob must occur verbatim in the documentation that
 * was sent. What the documentation does not state cannot be justified, so it
 * is refused rather than trusted. Whether the settings are *right* is then
 * measured by every construct's examples (comment and string traps).
 */
import { requestHash, structured, type LlmProvider, type LlmRequest } from '../llm/index.js';
import {
  boundLexicalDocs,
  buildLexicalMessage,
  buildLexicalRefinementMessage,
  DEFAULT_PROMPT_LIMITS,
  SYSTEM_PROMPT,
  type LexicalDoc,
  type PromptLimits,
} from './prompts.js';
import { LexicalProposalSchema, type LexicalProposal, type LexicalSettings } from './schema.js';
import type { Usage } from './types.js';

export interface LexicalAttempt {
  readonly attempt: number;
  readonly requestHash: string;
  readonly outcome: 'accepted' | 'invalid-output' | 'unjustified-settings' | 'not-justified';
  readonly problems: string[];
  readonly usage: Usage;
  readonly proposal?: LexicalProposal;
}

export type LexicalOutcome =
  | { readonly status: 'accepted'; readonly settings: LexicalSettings; readonly attempts: LexicalAttempt[] }
  | { readonly status: 'rejected' | 'not-justified' | 'no-documentation'; readonly reason: string; readonly attempts: LexicalAttempt[] };

export interface LexicalOptions {
  readonly languageId: string;
  /** General Skill files, in path order. */
  readonly docs: readonly LexicalDoc[];
  readonly maxAttempts: number;
  readonly maxOutputTokens: number;
  readonly limits?: PromptLimits;
}

const GLOB_ALLOWED = /^[^\s\\[\]{}!]+$/;

/** Literal pieces of a glob: the text between wildcards and `/`. */
export function globLiterals(glob: string): string[] {
  return glob.split(/\*\*|\*|\?|\//).filter((part) => part !== '');
}

/**
 * Runner-side checks of a lexical proposal against the documentation that
 * was sent. Returns a list of problems (empty: accepted).
 */
export function checkLexicalProposal(proposal: LexicalProposal, documentation: string): string[] {
  const problems: string[] = [];
  const inDocs = (text: string): boolean => documentation.includes(text);
  for (const glob of proposal.fileMatchers) {
    if (!GLOB_ALLOWED.test(glob)) {
      problems.push(`fileMatchers: ${JSON.stringify(glob)} uses characters outside the supported glob subset (only **, * and ? are wildcards; no spaces, braces, brackets or "!")`);
      continue;
    }
    if (glob.startsWith('/')) problems.push(`fileMatchers: ${JSON.stringify(glob)} must be relative (no leading "/")`);
    const literals = globLiterals(glob);
    if (literals.length === 0) {
      problems.push(`fileMatchers: ${JSON.stringify(glob)} matches every file; name what the documentation says identifies a source file (e.g. its extension)`);
    }
    for (const literal of literals) {
      if (!inDocs(literal)) problems.push(`fileMatchers: ${JSON.stringify(literal)} (from ${JSON.stringify(glob)}) does not appear in the documentation`);
    }
  }
  const markers: [string, string][] = [];
  if (proposal.lineComment !== undefined) markers.push(['lineComment', proposal.lineComment]);
  if (proposal.blockComment !== undefined) {
    markers.push(['blockComment.start', proposal.blockComment.start], ['blockComment.end', proposal.blockComment.end]);
  }
  (proposal.stringDelimiters ?? []).forEach((d, i) => {
    markers.push([`stringDelimiters[${String(i)}].start`, d.start], [`stringDelimiters[${String(i)}].end`, d.end]);
  });
  for (const [field, marker] of markers) {
    if (/\s/.test(marker)) problems.push(`${field}: ${JSON.stringify(marker)} contains whitespace`);
    else if (!inDocs(marker)) problems.push(`${field}: ${JSON.stringify(marker)} does not appear in the documentation`);
  }
  return problems;
}

function toSettings(proposal: LexicalProposal): LexicalSettings {
  return {
    fileMatchers: [...proposal.fileMatchers],
    ...(proposal.lineComment !== undefined ? { lineComment: proposal.lineComment } : {}),
    ...(proposal.blockComment !== undefined ? { blockComment: { ...proposal.blockComment } } : {}),
    ...(proposal.stringDelimiters !== undefined && proposal.stringDelimiters.length > 0
      ? { stringDelimiters: proposal.stringDelimiters.map((d) => ({ ...d })) }
      : {}),
  };
}

/** Asks for lexical settings, with bounded refinement (same attempt cap as constructs). */
export async function synthesizeLexical(provider: LlmProvider, options: LexicalOptions): Promise<LexicalOutcome> {
  const attempts: LexicalAttempt[] = [];
  if (options.docs.length === 0) {
    return {
      status: 'no-documentation',
      reason: 'no general Skill file (one that introduces no construct) describes files, comments and strings; lexical settings cannot be justified',
      attempts,
    };
  }
  const limits = options.limits ?? DEFAULT_PROMPT_LIMITS;
  const firstMessage = buildLexicalMessage(options.languageId, options.docs, limits);
  // The runner checks against exactly the documentation that was sent, not the instructions around it.
  const documentation = boundLexicalDocs(options.docs, limits)
    .map((doc) => doc.text)
    .join('\n');
  const messages: LlmRequest['messages'][number][] = [{ role: 'user', content: firstMessage }];

  for (let attempt = 1; attempt <= options.maxAttempts; attempt += 1) {
    const request: LlmRequest = { system: SYSTEM_PROMPT, messages: [...messages], maxOutputTokens: options.maxOutputTokens };
    const hash = requestHash(request);
    const res = await structured(provider, LexicalProposalSchema, request);
    const usage = { inputTokens: res.response.usage.inputTokens, outputTokens: res.response.usage.outputTokens };
    let problems: string[];
    if (!res.ok) {
      problems = [`${res.error.kind}: ${res.error.message}`];
      attempts.push({ attempt, requestHash: hash, outcome: 'invalid-output', problems, usage });
    } else if (res.value.notJustified !== undefined && res.value.fileMatchers.length === 0) {
      attempts.push({ attempt, requestHash: hash, outcome: 'not-justified', problems: [], usage, proposal: res.value });
      return { status: 'not-justified', reason: res.value.notJustified, attempts };
    } else {
      problems = checkLexicalProposal(res.value, documentation);
      if (problems.length === 0) {
        attempts.push({ attempt, requestHash: hash, outcome: 'accepted', problems, usage, proposal: res.value });
        return { status: 'accepted', settings: toSettings(res.value), attempts };
      }
      attempts.push({ attempt, requestHash: hash, outcome: 'unjustified-settings', problems, usage, proposal: res.value });
    }
    messages.push(
      { role: 'assistant', content: res.response.text.trim() === '' ? '(empty answer)' : res.response.text },
      { role: 'user', content: buildLexicalRefinementMessage(attempt, options.maxAttempts, problems) },
    );
  }
  const last = attempts[attempts.length - 1];
  return {
    status: 'rejected',
    reason: `no acceptable lexical settings after ${String(options.maxAttempts)} attempt(s); last problems: ${(last?.problems ?? []).join('; ')}`,
    attempts,
  };
}
