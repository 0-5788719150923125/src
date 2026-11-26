// Try a rule set (src/js/rules.js) on its labeled examples.
//
//   node scripts/rules.js [set]            how well it separates them, and
//                                          why it gets the misses wrong
//   node scripts/rules.js [set] --fit      weights fitted to the examples,
//                                          checked by cross-validation
//   node scripts/rules.js [set] "a line"   one line, rule by rule
//
// Sets: quality (src/js/quality.js, tests/quality.examples.json).

import fs from 'node:fs'
import path from 'node:path'
import { evaluate, explain, fit, measure } from '../src/js/rules.js'

const ROOT = path.join(import.meta.dirname, '..')
const SETS = {
    quality: {
        module: 'src/js/quality.js',
        exported: 'quality',
        examples: 'tests/quality.examples.json'
    }
}

const args = process.argv.slice(2)
const name = args[0] && SETS[args[0]] ? args.shift() : 'quality'
const where = SETS[name]
const set = (await import(path.join(ROOT, where.module)))[where.exported]
const data = JSON.parse(
    fs.readFileSync(path.join(ROOT, where.examples), 'utf8')
)
const examples = [
    ...data.good.map((line) => [line, 1]),
    ...data.bad.map((line) => [line, 0])
]
const pct = (x) => `${(100 * x).toFixed(1)}%`

function report(label, rules) {
    const { accuracy, auc, scored } = measure(rules, examples)
    console.log(
        `${label}: accuracy ${pct(accuracy)}, AUC ${auc.toFixed(3)} (${examples.length} examples)`
    )
    const misses = scored.filter((s) => s.score >= 0.5 !== Boolean(s.label))
    for (const miss of misses) {
        console.log(
            `  ${miss.label ? 'good scored low ' : 'bad scored high '} ${miss.score.toFixed(2)}  ${JSON.stringify(miss.input)}  ${explain(miss)}`
        )
    }
}

// Accuracy on examples each fit never saw: k folds, each held out in turn.
function crossValidate(folds = 5) {
    let seed = 1
    const shuffled = [...examples].sort(
        () => (seed = (seed * 16807) % 2147483647) / 2147483647 - 0.5
    )
    let right = 0
    for (let k = 0; k < folds; k++) {
        const held = shuffled.filter((_, i) => i % folds === k)
        const trained = fit(
            set,
            shuffled.filter((_, i) => i % folds !== k)
        )
        right += held.filter(
            ([input, label]) =>
                evaluate(trained, input).score >= 0.5 === Boolean(label)
        ).length
    }
    return right / examples.length
}

if (args[0] && args[0] !== '--fit') {
    const result = evaluate(set, args[0])
    console.log(
        `${name}: ${result.score.toFixed(3)} (total ${result.total.toFixed(2)})`
    )
    for (const rule of result.fired) {
        const about = set.rules.find((r) => r.name === rule.name).about
        console.log(
            `  ${rule.contribution >= 0 ? '+' : ''}${rule.contribution.toFixed(2).padStart(5)}  ${rule.name.padEnd(15)} ${about}`
        )
    }
} else if (args[0] === '--fit') {
    report('as written', set)
    const fitted = fit(set, examples)
    report('fitted', fitted)
    console.log(
        `held-out accuracy of fitting (5 folds): ${pct(crossValidate())}`
    )
    console.log('\nfitted weights, to paste into the rule set:')
    console.log(`  bias: ${fitted.bias.toFixed(2)}`)
    for (const rule of fitted.rules)
        console.log(`  ${rule.name}: ${rule.weight.toFixed(2)}`)
} else {
    report(name, set)
}
