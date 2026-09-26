/**
 * `lsc review <results.json>`: an interactive terminal flow stepping
 * through unreviewed repository-sample matches (WP-07 brief, D9). Each
 * verdict (`correct` / `false positive` / `skip`) is written to
 * `reviews.yaml` in the WP-03 format (D15) as soon as it is entered, so an
 * interrupted session loses nothing already decided.
 *
 * The brief's literal command line is `lsc review <results.json>`, but
 * `reviews.yaml`'s location (D15: a sibling of the Skill directory) cannot
 * be derived from `results.json` alone, so this command needs one more
 * piece of information: `--skills-dir` (the usual convention) or
 * `--reviews-file` (an explicit path). See this package's completion note.
 *
 * Terminal I/O (`readline`) lives only in this file; the session logic it
 * drives (`runReviewSession`, src/report/review-session.ts) is plain
 * functions, so it is unit-tested without mocking a terminal.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createInterface } from 'node:readline/promises';
import type { Command } from 'commander';
import { loadRuleSetFile } from '../../contract/load.js';
import { exampleLocations, loadReviews, stringifyReviews } from '../../examples/index.js';
import { loadResultsFile } from '../../report/load-results.js';
import { collectUnreviewedMatches, runReviewSession, type UnreviewedMatch } from '../../report/review-session.js';

export const name = 'review';
export const description = 'Step through unreviewed sample matches and record verdicts into reviews.yaml';

interface Options {
  readonly skillsDir?: string;
  readonly reviewsFile?: string;
  readonly ruleset?: string;
  readonly sample?: string;
}

function resolveReviewsFile(options: Options): string {
  if (options.reviewsFile !== undefined) return options.reviewsFile;
  if (options.skillsDir !== undefined) return exampleLocations(options.skillsDir).reviewsFile;
  throw new Error('pass --skills-dir (the usual convention, D15) or --reviews-file so lsc review knows where to write reviews.yaml');
}

/**
 * Reads a sample file's raw text by its repository-relative path
 * (`SampleMatch.file`, `/` separators), resolved against `--sample <dir>`.
 * `buildReviewEntry` needs the actual text to recompute a match's line span
 * and check for other same-rule matches on those lines (src/report/match-span.ts,
 * src/examples/README.md §4); the ±3-line snippet already in `results.json`
 * is not always enough (a multiline match can span more than that).
 */
function makeSampleFileReader(sampleDir: string): (file: string) => string | undefined {
  return (file: string): string | undefined => {
    try {
      return readFileSync(join(sampleDir, ...file.split('/')), 'utf8');
    } catch {
      return undefined;
    }
  };
}

function printMatch(item: UnreviewedMatch, index: number, total: number): void {
  process.stdout.write(`\n[${String(index + 1)}/${String(total)}] rule ${item.ruleId} — ${item.match.file}:${String(item.match.line)}\n`);
  if (item.match.enclosingSymbol !== undefined) process.stdout.write(`  in ${item.match.enclosingSymbol}\n`);
  process.stdout.write(`  captures: ${JSON.stringify(item.match.captures)}\n`);
  for (const line of item.match.snippet) {
    process.stdout.write(`  ${String(line.line).padStart(5)}${line.line === item.match.line ? ' > ' : '   '}${line.text}\n`);
  }
}

export function configure(cmd: Command): void {
  cmd
    .argument('<results>', 'Results JSON file (written by `lsc test` or `lsc compile`)')
    .option('--skills-dir <dir>', "Skill directory (reviews.yaml is written to its sibling, D15's convention)")
    .option('--reviews-file <file>', 'write to this reviews.yaml path instead of deriving it from --skills-dir')
    .option('--ruleset <file>', "the Rule Set the sample scan ran with (needed to recompute a match's line span, src/report/match-span.ts)")
    .option('--sample <dir>', 'the repository sample directory the scan ran against (same one passed to `lsc test`/`lsc compile`)')
    .action(async (resultsPath: string, options: Options) => {
      let reviewsFile: string;
      try {
        reviewsFile = resolveReviewsFile(options);
      } catch (error) {
        process.exitCode = 1;
        process.stderr.write(`ERROR: ${error instanceof Error ? error.message : String(error)}\n`);
        return;
      }

      if (options.ruleset === undefined || options.sample === undefined) {
        process.exitCode = 1;
        process.stderr.write(
          'ERROR: pass --ruleset <file> and --sample <dir> (the same Rule Set and repository sample the results were produced from) ' +
            "so lsc review can recompute a match's line span and check for other same-rule matches on it (src/examples/README.md §4)\n",
        );
        return;
      }

      const loadedResults = loadResultsFile(resultsPath);
      if (!loadedResults.ok) {
        process.exitCode = 1;
        process.stderr.write(`ERROR: ${loadedResults.error}\n`);
        return;
      }

      const loadedRuleSet = loadRuleSetFile(options.ruleset);
      if (!loadedRuleSet.ok) {
        process.exitCode = 1;
        process.stderr.write(`ERROR: ${options.ruleset} is not a valid Rule Set\n`);
        return;
      }

      const existing = loadReviews(reviewsFile, { allowMissing: true });
      if (existing.errors.length > 0) {
        process.exitCode = 1;
        process.stderr.write(`ERROR: ${reviewsFile} has existing errors; fix it before adding new reviews (a rewrite would drop the invalid entries):\n`);
        for (const error of existing.errors) {
          process.stderr.write(`  ${error.file}${error.line !== undefined ? `:${String(error.line)}` : ''}: ${error.message}\n`);
        }
        return;
      }

      if (collectUnreviewedMatches(loadedResults.results).length === 0) {
        process.stdout.write('No unreviewed sample matches.\n');
        return;
      }

      const readSampleFile = makeSampleFileReader(options.sample);

      const rl = createInterface({ input: process.stdin, output: process.stdout });
      let result;
      try {
        result = await runReviewSession(
          loadedResults.results,
          existing.entries,
          { ruleSet: loadedRuleSet.ruleSet, readSampleFile },
          {
            ask: async (item, index, total) => {
              printMatch(item, index, total);
              return rl.question('  verdict [c]orrect / [f]alse positive / [s]kip / [q]uit > ');
            },
            onRecorded: (entries) => {
              writeFileSync(reviewsFile, stringifyReviews(entries));
            },
            onSkipped: (_item, reason) => {
              process.stdout.write(`  skipped: ${reason}\n`);
            },
          },
        );
      } finally {
        rl.close();
      }

      if (result.quit) process.stdout.write('  stopping; earlier verdicts were already saved\n');
      const wroteFile = result.entries.length > existing.entries.length;
      process.stdout.write(
        `\nDone: ${String(result.correct)} correct, ${String(result.falsePositive)} false positive, ${String(result.skipped)} skipped.` +
          `${wroteFile ? ` Wrote ${reviewsFile}\n` : ' Nothing recorded; reviews.yaml unchanged.\n'}`,
      );
    });
}
