import { createHash } from 'node:crypto';
import { z } from 'zod';
import { InvalidRequestError } from './errors.js';
import type { LlmRequest } from './types.js';

export const LlmMessageSchema = z.strictObject({
  role: z.enum(['user', 'assistant']),
  content: z.string().min(1),
});

export const LlmRequestSchema = z
  .strictObject({
    system: z.string(),
    messages: z.array(LlmMessageSchema).min(1),
    maxOutputTokens: z.number().int().positive(),
  })
  .superRefine((req, ctx) => {
    if (req.messages[0]?.role !== 'user') {
      ctx.addIssue({ code: 'custom', path: ['messages', 0, 'role'], message: 'first message must have role "user"' });
    }
    for (let i = 1; i < req.messages.length; i++) {
      if (req.messages[i]?.role === req.messages[i - 1]?.role) {
        ctx.addIssue({
          code: 'custom',
          path: ['messages', i, 'role'],
          message: 'roles must alternate between "user" and "assistant"',
        });
      }
    }
  });

/** Throws `InvalidRequestError` if the request is malformed. */
export function assertValidRequest(request: LlmRequest): void {
  const parsed = LlmRequestSchema.safeParse(request);
  if (!parsed.success) {
    const detail = parsed.error.issues
      .map((i) => `${i.path.map(String).join('.') || '(root)'}: ${i.message}`)
      .join('; ');
    throw new InvalidRequestError(`invalid model request: ${detail}`);
  }
}

/**
 * Stable key of a request, used to find recordings (D7) and in the snippet log.
 *
 * sha256 of canonical JSON of `system` and `messages` (role, content) only.
 * `maxOutputTokens` is excluded on purpose: changing a budget in
 * `lsc.config.json` must not invalidate every recording. Provider and model
 * are excluded so recordings replay regardless of the configured model.
 */
export function requestHash(request: Pick<LlmRequest, 'system' | 'messages'>): string {
  const canonical = JSON.stringify({
    system: request.system,
    messages: request.messages.map((m) => ({ role: m.role, content: m.content })),
  });
  return createHash('sha256').update(canonical, 'utf8').digest('hex');
}
