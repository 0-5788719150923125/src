# Crawl

*On a model that rides a wave by choosing what to read.*

> Status: superseded. Two probes, on 2026-11-18; nothing was built. It kept [witness.md](witness.md)'s tallies, looked for a better goal, and found a pace without a direction. Followed by [proposal.md](proposal.md). The probes are in git history, at commit 6cd0317.

---

## The Surfer

A surfer does not try to reach the shore. The wave rises and falls on its own schedule, and the surfer's whole skill is staying on it: shifting weight forward, then back, a little at a time, choosing at each moment where to stand.

The witness note ended with good machinery and a bad goal: telling members apart by their writing. This note tried a goal with nothing to win at all. The model's error would not be a score to drive toward zero. It would be a clock: a target that rises and falls on a fixed wave, forever. The model's job would be to stay on the wave, and its only way to move would be choosing what to read.

Why would that be good? There were three hopes.

**It never converges**, so it can never collapse into everyone sounding alike. There is nowhere to converge to.

**Every change comes from something read.** Each step starts from a pair: a passage of the member's own writing (their *signature*, fixed, the origin everything is measured from) and a passage of anything else. The difference between the two, quite literally the three-letter fragments one has and the other lacks, is a step the model can take, pushing the two apart or pulling them together. No random coin flips, and no calculus.

**A model would be a reading list.** The signature, plus the passages chosen, in order, each with a sign. Small enough to send, exact to replay, and legible: every weight traces back to something the model chose to read. And nothing in it compares one member's writing with another's, so nothing learns to tell members apart.

---

## What the Probes Showed

**Random steps cannot ride.** The witness probe, told to hold its distances on a wave, either swelled and shrank everything together and learned nothing, or could not keep up at all. The steps had to come from the text.

**Steps taken from the text can.** In the second probe, 128 peers each took one web document as their signature, and all of them shared one table of tallies. At each tick, a peer that had drifted off its wave was offered eight random passages from a library of 3,556 documents, and could step along one. The peers held within about 1% of their wave, and most ticks needed no step at all. A peer that chose the passage it needed took about 30% fewer steps than one that took whatever came. Even when every peer decided before anyone's step landed, the wave held, at about three times the steps.

**But a wave ridden well leaves nothing behind.** Tested on 800 documents nobody read, the table was no better at telling which passages belonged together than when it started. Pushes and pulls along different passages mostly neither cancelled nor added up; the table wandered, like a random walk.

**The one rule that learned ran away.** "Push the farthest passage away, pull the nearest closer" did learn: in two cycles, about half as much as a version simply told the right answers. It did it by piling the whole table onto a single direction. Then the peers lost the wave, and the score sank below where it had started. A more careful version, taking only steps predicted to help, held on one cycle longer and ended the same way.

**A still core, and separate tendrils.** Give each peer its own phase on the wave, and 128 peers ride 128 waves on one shared table, each moving rows nobody else moves, while text nobody holds barely moves at all. That was the shape predicted: a stable core, with a tendril for each peer. But the core was still only because nobody moved it; it was the untrained table. And a tendril held its peer on the wave, and nothing could be asked of it.

**More peers still ride, but harder.** At 512 peers instead of 128, each worked harder to hold its place, and the table got a little worse. The limit was never computing power. It was how much one peer's step moves another's.

---

## The Gap

A wave says *when* to move, and *how far*. It does not say *what to learn*.

The probe made that concrete. Held on the wave by a rule with no preference, the table drifts and keeps nothing. Whatever is learned has to come from a difference between what gets chosen on the way up and what gets chosen on the way down. The one such difference tried, by distance, feeds on itself: far things are pushed farther, until one direction holds everything.

The wave cannot stop that. It fixes one number per peer, and leaves the table free to take any shape that keeps that number. The wave is a pace, not a direction.

So the open problem, restated: a rule for what to read whose preference adds up across many directions, and does not feed on itself. What the whole thing was *for* stayed open too. The best answer at the time: a model whose history is complete, because it is nothing but the list of what it read.

---

## What Survived

[proposal.md](proposal.md) dropped the goal of growing a model in weights, and grew it in memory instead. But the reading list carried over. The proposal's daemons are reading lists, and its library learns by choosing what to keep, not by changing weights. And when the proposal bred reading lists, it ran into this note's warning: selection converged within five generations.

---

## The Next Probe, Had It Gone On

- **A reference that does not collapse.** The version told the right answers also ended on one direction, so nobody knows what the table's sixteen directions could hold. Keep the directions apart while pulling each document's passages together, and see.
- **A preference that does not feed on itself.** Let each direction choose its own passage, so they cannot all follow the same one. Or pull only with two passages of the signature, the one thing a peer knows goes together, and push only with the library.

If the better reference scored no higher than the first, the table would be too small to say anything, and the test should change before the rule does.

---

## Older Ideas Nearby

From memory, not checked against sources:

- Learning with one phase that learns and one that unlearns, cancelling at balance: Boltzmann machines, wake-sleep, contrastive Hebbian learning.
- A teaching signal that oscillates, with the change read off at the wave's own frequency: Baldi and Pineda (1991), holomorphic equilibrium propagation (2022). The engineering name is a lock-in amplifier.
- Weights written as a signed list of examples: support vectors, and the perceptron, which updates only when it must.
- Choosing the examples that steer a learner: machine teaching, active learning.
- Holding a loss at a level instead of at zero: flooding (2020).
- Strengthening what is already strong until one direction wins, and the fixes added to keep several apart: Hebbian learning, Oja's rule, Sanger's rule.

---

## The Numbers

The corpus: 4,484 web documents of 4 KiB each from MiniPile; 800 held out and never read, 128 taken as signatures, 3,556 in the library. The table: 8,192 rows of hashed three-letter fragments, by 16 columns of whole-number tallies. A peer's wave ran 25% above and below its starting error, 128 ticks to a cycle, for six cycles. The score: how often a held-out passage sits closer to the other half of its own document than to a stranger's (chance is 0.5; the untrained table scored 0.612).

One wave for the whole swarm:

| How a peer chose | Off its wave | Ticks with a step | Held-out score | Directions used, of 16 |
|---|---|---|---|---|
| any passage on offer | 1.2% | 18% | 0.609 to 0.620 | 14.9 |
| the one predicted to land nearest the wave | 1.1% | 13% | 0.616 to 0.625 | 14.7 |
| push the nearest, pull the farthest | 1.3% | 19% | 0.610 to 0.617 | 15.4 |
| push the farthest, pull the nearest | 1.3%, then 113% | 19%, then 89% | 0.680 at cycle 2, 0.625 at cycle 6 | 1.1 |
| the same, only steps predicted to help | 1.2%, then 27% | 16%, then 73% | 0.649 at cycle 3, 0.582 at cycle 6 | 1.2 |
| told which passages share a document, no wave | - | 100% | 0.757 | 1.0 |

"Off its wave" is the average gap between a peer's error and its wave, as a share of its starting error.

One wave, against a phase of its own for every peer (choosing the passage predicted to land nearest):

| | One wave | A phase per peer |
|---|---|---|
| Off its wave | 1.1% | 1.6% |
| Ticks with a step | 13% | 33% |
| How much held-out distances moved within a cycle | 0.33 | 0.01 to 0.02 |
| Overlap between two peers' net changes (cosine) | 0.000 | -0.001 |

More peers:

| | 128 peers | 512 peers |
|---|---|---|
| One wave: off its wave, ticks with a step | 1.1%, 13% | 1.6%, 28% |
| A phase per peer: off its wave, ticks with a step | 1.6%, 33% | 2.2%, 45% |
| Held-out score after two cycles (one wave, a phase per peer) | 0.622, 0.606 | 0.599, 0.594 |

With every peer deciding before any step landed, the wave held at 2.0% off, with nearly three times the steps. An earlier version of the probe could not hold the wave at 128 peers at all (10% to 20% off); it used raw fragment counts and let a pull carry a tally through zero. Both were changed at once, so which one mattered was never isolated; the likely one is the counts, since common fragments put every step partly on the same rows.
