// Rules: scoring by small, readable heuristics, in the manner of
// SpamAssassin. A rule looks at one thing about its input and says how it
// looks on that point, from -1 (bad) to 1 (good), 0 when it has nothing to
// say; it may name its kind, so its part of a score can be read alone
// (part). A rule set is data: its rules, a weight for each, and a bias. The
// score is the weighted sum through a logistic curve, so it runs from 0 to
// 1, and every score can be explained by the rules that moved it.
//
// Weights can be set by hand or fitted to labeled examples (fit); either
// way the rules stay readable. Rule sets so far: quality.js. Imports
// nothing, touches no DOM; tested under Node, and tried out with
// scripts/rules.js.

const clamp = (value) => Math.max(-1, Math.min(1, Number(value) || 0))

// The score of `input` under `set`: { score, total, fired }, where fired
// lists every rule with its value and what it added to the total.
export function evaluate(set, input, context = {}) {
    const fired = set.rules.map((rule) => {
        const value = clamp(rule.test(input, context))
        return { name: rule.name, kind: rule.kind, value, contribution: rule.weight * value }
    })
    const total = set.bias + fired.reduce((sum, rule) => sum + rule.contribution, 0)
    return { score: 1 / (1 + Math.exp(-total)), total, fired }
}

// What the rules of one kind added to a score.
export const part = (result, kind) =>
    result.fired.filter((rule) => rule.kind === kind).reduce((sum, rule) => sum + rule.contribution, 0)

// The rules that moved a score most, in words: "+1.0 ends-well, -1.5 ...".
export const explain = (result, top = 4) =>
    result.fired
        .filter((rule) => rule.contribution)
        .sort((a, b) => Math.abs(b.contribution) - Math.abs(a.contribution))
        .slice(0, top)
        .map((rule) => `${rule.contribution > 0 ? '+' : ''}${rule.contribution.toFixed(1)} ${rule.name}`)
        .join(', ')

// The same rules with other weights or bias: { bias, weights: { name: w } }.
export const tuned = (set, { bias, weights = {} } = {}) => ({
    ...set,
    bias: bias ?? set.bias,
    rules: set.rules.map((rule) => ({ ...rule, weight: weights[rule.name] ?? rule.weight }))
})

// Weights fitted to labeled examples ([input, 1 or 0] pairs) by logistic
// regression, a little shrinkage keeping them small. The rules are not
// touched: only how much each counts.
export function fit(set, examples, { rounds = 2000, rate = 0.05, shrink = 0.001 } = {}) {
    const rows = examples.map(([input, label]) => ({ values: set.rules.map((rule) => clamp(rule.test(input, {}))), label }))
    const weights = set.rules.map((rule) => rule.weight)
    let bias = set.bias
    for (let round = 0; round < rounds; round++) {
        const grads = weights.map(() => 0)
        let gradBias = 0
        for (const { values, label } of rows) {
            const total = bias + values.reduce((sum, v, i) => sum + v * weights[i], 0)
            const error = 1 / (1 + Math.exp(-total)) - label
            values.forEach((v, i) => (grads[i] += error * v))
            gradBias += error
        }
        weights.forEach((w, i) => (weights[i] = w - rate * (grads[i] / rows.length + shrink * w)))
        bias -= rate * (gradBias / rows.length)
    }
    return tuned(set, { bias, weights: Object.fromEntries(set.rules.map((rule, i) => [rule.name, weights[i]])) })
}

// How well a rule set separates labeled examples: accuracy at a score of
// 0.5, and the area under the ROC curve (the chance that a good example
// outscores a bad one).
export function measure(set, examples) {
    const scored = examples.map(([input, label]) => ({ input, label, ...evaluate(set, input) }))
    const right = scored.filter((s) => (s.score >= 0.5) === Boolean(s.label)).length
    const good = scored.filter((s) => s.label).map((s) => s.score)
    const bad = scored.filter((s) => !s.label).map((s) => s.score)
    let pairs = 0
    for (const g of good) for (const b of bad) pairs += g > b ? 1 : g === b ? 0.5 : 0
    return { accuracy: right / scored.length, auc: pairs / (good.length * bad.length || 1), scored }
}
