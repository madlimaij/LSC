/**
 * Where a language's example sources live, relative to its Skill directory.
 *
 * Convention (docs/DECISIONS.md D15): a language inputs directory holds three
 * siblings,
 *
 *     <language>/skills/         Skill files (the <skills-dir> CLI argument)
 *     <language>/examples/       sidecar examples: examples/<construct>/<id>.<ext>
 *     <language>/reviews.yaml    review verdicts (D9)
 *
 * Both example sources are optional. Commands may accept options that
 * override these paths.
 */
import { dirname, join, resolve } from 'node:path';

export interface ExampleLocations {
  readonly examplesDir: string;
  readonly reviewsFile: string;
}

export function exampleLocations(skillsDir: string): ExampleLocations {
  const languageDir = dirname(resolve(skillsDir));
  return {
    examplesDir: join(languageDir, 'examples'),
    reviewsFile: join(languageDir, 'reviews.yaml'),
  };
}
