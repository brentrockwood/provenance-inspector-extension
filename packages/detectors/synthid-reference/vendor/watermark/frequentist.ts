/**
 * How surprising is this score if the text carries no mark for this key?
 *
 * PAPER-FAITHFUL. The paper gives a closed-form null for the Bernoulli(0.5) case in
 * Supplementary Information A.3:
 *
 *     p-value = 1 − CDF_{Binomial(mT, 0.5)}( [Σ_t Σ_ℓ g_{t,ℓ}] − 1 )
 *
 * which is exactly P(X ≥ observed sum) for X ~ Binomial(mT, 1/2). It rests on the
 * statement, in the same appendix, that "Under the null hypothesis, each g_{t,ℓ} follows
 * the g-value distribution f_g … furthermore if we apply repeated context masking … then
 * the g_{t,ℓ} are independent."
 *
 * Two things are worth holding onto while reading any p-value this file produces.
 *
 * First, the independence argument is about the paper's idealised construction, in which
 * the hash is assumed to be a pseudorandom function family. The reference implementations
 * use a linear congruential generator, and the reference repository states in its own
 * README that it "does not provide any guarantees of cryptographic security". So the
 * closed form is computed here, and the lab also measures an empirical null and shows the
 * two side by side rather than asserting that they agree.
 *
 * Second, the paper's own reported detection numbers do not use these p-values: "Although
 * some scoring functions allow a precise theoretical guarantee on the false-positive
 * rate … in this work we take the empirical approach described above."
 */

/** Log-gamma by the Lanczos approximation. Accurate to ~15 significant digits for x > 0. */
export function logGamma(x: number): number {
  const coefficients = [
    676.5203681218851, -1259.1392167224028, 771.32342877765313,
    -176.61502916214059, 12.507343278686905, -0.13857109526572012,
    9.9843695780195716e-6, 1.5056327351493116e-7,
  ];
  if (x < 0.5) {
    // Reflection, so the function is defined either side of the pole structure.
    return Math.log(Math.PI / Math.sin(Math.PI * x)) - logGamma(1 - x);
  }
  const z = x - 1;
  let a = 0.99999999999980993;
  for (let i = 0; i < coefficients.length; i++) a += coefficients[i] / (z + i + 1);
  const t = z + coefficients.length - 0.5;
  return 0.5 * Math.log(2 * Math.PI) + (z + 0.5) * Math.log(t) - t + Math.log(a);
}

/** log C(n, k). */
export function logBinomialCoefficient(n: number, k: number): number {
  return logGamma(n + 1) - logGamma(k + 1) - logGamma(n - k + 1);
}

export interface ExactTail {
  /** P(X >= observed) for X ~ Binomial(trials, 1/2). */
  readonly pValue: number;
  /** log10 of the same, which stays meaningful after the p-value underflows to 0. */
  readonly log10PValue: number;
  readonly trials: number;
  readonly observedSum: number;
  /** Sum expected under the null: trials / 2. */
  readonly nullExpectedSum: number;
}

/**
 * Exact upper tail of Binomial(trials, 1/2), summed in log space.
 *
 * Summing in log space is not fastidiousness. At the lengths this lab works with the
 * p-values reach 10^-80 and beyond, where a naive sum of probabilities is just zero and
 * the page would be reporting "p = 0", which is a claim no finite experiment supports.
 */
export function binomialUpperTail(observedSum: number, trials: number): ExactTail {
  const k0 = Math.ceil(observedSum);
  const nullExpectedSum = trials / 2;
  if (trials <= 0) {
    return { pValue: Number.NaN, log10PValue: Number.NaN, trials, observedSum, nullExpectedSum };
  }
  if (k0 <= 0) {
    return { pValue: 1, log10PValue: 0, trials, observedSum, nullExpectedSum };
  }
  if (k0 > trials) {
    return { pValue: 0, log10PValue: -Infinity, trials, observedSum, nullExpectedSum };
  }

  const logTerms: number[] = [];
  const logHalfPower = -trials * Math.LN2;
  for (let k = k0; k <= trials; k++) {
    logTerms.push(logBinomialCoefficient(trials, k) + logHalfPower);
  }
  const maxLog = Math.max(...logTerms);
  let acc = 0;
  for (const term of logTerms) acc += Math.exp(term - maxLog);
  const logP = maxLog + Math.log(acc);
  return {
    pValue: Math.exp(logP),
    log10PValue: logP / Math.LN10,
    trials,
    observedSum,
    nullExpectedSum,
  };
}

export interface NormalApproximation {
  readonly standardError: number;
  readonly z: number;
}

/**
 * The normal approximation to the same null, on the mean-g scale.
 *
 * The paper offers it as a fallback "If the Binomial or Irwin-Hall CDFs are not easily
 * computable", and derives the weighted version with μ = m/2 and σ² = (1/4) Σ α_ℓ² per
 * step; with every weight set to 1 that is a per-step variance of m/4, so the mean over
 * scored positions has standard error sqrt(1 / (4 · m · T)).
 *
 * The exact tail above is computable here, so this is shown for comparison rather than
 * used for decisions — and comparing it against the measured empirical null is one of
 * the things this lab exists to let a reader do.
 */
export function normalApproximation(
  observedMean: number,
  scoredPositions: number,
  depth: number,
): NormalApproximation | null {
  const n = scoredPositions * depth;
  if (n <= 0) return null;
  const standardError = Math.sqrt(0.25 / n);
  return { standardError, z: (observedMean - 0.5) / standardError };
}
