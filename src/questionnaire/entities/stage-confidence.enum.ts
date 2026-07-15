/**
 * Extracted from learner-profile-snapshot.entity to break the eager circular
 * import between the profile snapshot and skill estimate entities (column
 * decorators need this enum at module-evaluation time).
 */
export enum StageConfidence {
  Low = 'low',
  Medium = 'medium',
  High = 'high',
}
