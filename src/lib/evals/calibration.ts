export interface CalibrationScore {
  human: number;
  judge: number;
}

export interface CalibrationReport {
  sampleSize: number;
  spearman: number | null;
  meanAbsoluteError: number | null;
  judgeEligible: boolean;
}

export const MIN_CALIBRATION_SAMPLES = 15;

export function calibrationReport(
  scores: CalibrationScore[],
): CalibrationReport {
  if (!scores.length)
    return {
      sampleSize: 0,
      spearman: null,
      meanAbsoluteError: null,
      judgeEligible: false,
    };
  const human = scores.map((score) => score.human);
  const judge = scores.map((score) => score.judge);
  const spearman = human.length > 1 ? pearson(rank(human), rank(judge)) : null;
  const meanAbsoluteError =
    scores.reduce(
      (sum, score) => sum + Math.abs(score.human - score.judge),
      0,
    ) / scores.length;
  return {
    sampleSize: scores.length,
    spearman,
    meanAbsoluteError,
    judgeEligible:
      scores.length >= MIN_CALIBRATION_SAMPLES &&
      spearman != null &&
      spearman >= 0.7 &&
      meanAbsoluteError <= 0.75,
  };
}

function rank(values: number[]): number[] {
  return values.map(
    (value) => 1 + values.filter((candidate) => candidate < value).length,
  );
}

function pearson(a: number[], b: number[]): number {
  const meanA = a.reduce((sum, value) => sum + value, 0) / a.length;
  const meanB = b.reduce((sum, value) => sum + value, 0) / b.length;
  const numerator = a.reduce(
    (sum, value, index) => sum + (value - meanA) * (b[index] - meanB),
    0,
  );
  const denominator = Math.sqrt(
    a.reduce((sum, value) => sum + (value - meanA) ** 2, 0) *
      b.reduce((sum, value) => sum + (value - meanB) ** 2, 0),
  );
  return denominator === 0 ? 0 : numerator / denominator;
}
