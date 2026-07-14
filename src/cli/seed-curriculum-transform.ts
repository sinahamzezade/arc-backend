/**
 * Runnable seed transform: curriculum JSON → content_outline shapes.
 *
 *   npx ts-node -r tsconfig-paths/register src/cli/seed-curriculum-transform.ts
 *
 * Validates every lesson; exits non-zero on missing conceptTag / verbatim recovery.
 * Does not write DB — SkillGraphService.ensureSeeded applies outlines on boot.
 */
import { writeFileSync } from 'fs';
import { join } from 'path';
import { loadCatalogSeed } from '../skill-graph/seeds/catalog.seed';
import {
  transformCurriculumLesson,
  validateTransformedOutline,
} from '../skill-graph/seeds/transform-curriculum';

function main() {
  const catalog = loadCatalogSeed();
  const outlines: Array<{
    skillSlug: string;
    lessonSlug: string;
    outline: ReturnType<typeof transformCurriculumLesson>;
  }> = [];
  let ok = 0;
  const errors: string[] = [];

  for (const stack of catalog.stacks) {
    for (const skill of stack.skills) {
      for (const lesson of skill.lessons) {
        try {
          const outline = transformCurriculumLesson({
            skillSlug: skill.slug,
            lessonSlug: lesson.slug,
            title: lesson.title,
            missionNameTemplate: lesson.missionNameTemplate,
            lessonType: lesson.lessonType,
            content: lesson.content,
          });
          validateTransformedOutline(outline);
          outlines.push({
            skillSlug: skill.slug,
            lessonSlug: lesson.slug,
            outline,
          });
          ok += 1;
        } catch (err) {
          errors.push(
            `${skill.slug}/${lesson.slug}: ${
              err instanceof Error ? err.message : String(err)
            }`,
          );
        }
      }
    }
  }

  // eslint-disable-next-line no-console
  console.log(
    `Transformed ${ok} lessons; ${errors.length} failed validation.`,
  );
  if (errors.length) {
    for (const e of errors.slice(0, 20)) {
      // eslint-disable-next-line no-console
      console.error(e);
    }
    process.exit(1);
  }

  const outPath = join(
    process.cwd(),
    'course',
    '.transformed-outlines.sample.json',
  );
  writeFileSync(
    outPath,
    JSON.stringify(
      outlines.slice(0, 3).map((o) => ({
        skillSlug: o.skillSlug,
        lessonSlug: o.lessonSlug,
        conceptTags: [
          o.outline.practice.conceptTag,
          ...o.outline.quiz.map((q) => q.conceptTag),
        ],
        rewardClass: o.outline.rewardPresentation?.rewardClass,
        remediationKeys: Object.keys(o.outline.remediation ?? {}),
      })),
      null,
      2,
    ),
  );
  // eslint-disable-next-line no-console
  console.log(`Sample summary written to ${outPath}`);
}

main();
