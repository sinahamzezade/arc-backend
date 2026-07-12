import { QUESTIONNAIRE_SEED } from './schema/seed-data';
import { parseAndAssertQuestionnaireAiCopy } from './questionnaire-ai.schema';

describe('parseAndAssertQuestionnaireAiCopy', () => {
  const base = QUESTIONNAIRE_SEED;

  function validCopy() {
    return {
      steps: base.steps.map((step) => ({
        id: step.id,
        title: `AI ${step.title}`,
        subtitle: `AI ${step.subtitle}`,
        reviewLabel: `AI ${step.reviewLabel}`,
        options: step.options.map((o) => ({
          value: o.value,
          label: `AI ${o.label}`,
        })),
        ...(step.scheduleTimes?.length
          ? {
              scheduleTimes: step.scheduleTimes.map((t) => ({
                value: t.value,
                label: `AI ${t.label}`,
              })),
            }
          : {}),
      })),
    };
  }

  it('accepts full rewrite with frozen ids/values', () => {
    const parsed = parseAndAssertQuestionnaireAiCopy(validCopy(), base);
    expect(parsed.steps).toHaveLength(base.steps.length);
    expect(parsed.steps[0].title).toMatch(/^AI /);
  });

  it('rejects unknown step id', () => {
    const bad = validCopy();
    bad.steps[0].id = 'not-a-step';
    expect(() => parseAndAssertQuestionnaireAiCopy(bad, base)).toThrow(
      /Unknown AI step id/,
    );
  });

  it('rejects unknown option value', () => {
    const bad = validCopy();
    const goal = bad.steps.find((s) => s.id === 'goal')!;
    goal.options[0].value = 'hacker';
    expect(() => parseAndAssertQuestionnaireAiCopy(bad, base)).toThrow(
      /Unknown option value/,
    );
  });

  it('rejects missing step', () => {
    const bad = validCopy();
    bad.steps.pop();
    expect(() => parseAndAssertQuestionnaireAiCopy(bad, base)).toThrow(
      /step count/,
    );
  });
});
