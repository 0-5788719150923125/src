# Crawl: a model that rides a wave by choosing what to read

> Status: **raw capture, two probes** (2026-11-18). Nothing is built.
> Supersedes the objective in [witness.md](witness.md) and keeps its
> counters. The probes, `crawl.mjs` and the earlier `counter_net.mjs` with
> `WAVE` set, were removed on 2026-11-21 (in git history at commit
> 6cd0317). Followed by [proposal.md](proposal.md).

## The one line

The loss is a clock, not a score. It rises and falls on a fixed wave, and the
model stays on the wave by choosing which example to step along. The
signature is the origin every step is measured from.

## The three parts

- **The wave.** The target loss is periodic and costs as much as it rewards.
  The model never converges, because there is nowhere to converge to. What
  the wave carries is rhythm: when to pull an example toward the signature,
  when to push it away, and how far.
- **Weights in data-space.** Every input is a pair: a passage of the frozen
  signature (bias) and a passage of something else (variance). The difference
  between the two is a direction in weight space. In the probe this is
  literal - the trigrams one passage has and the other lacks are an integer
  vector that is added to the counters. No random seed and no backward pass.
- **The crawl.** The model picks the example whose direction it needs to stay
  on the wave. Most examples are never used. A step is a decision.

## What a model is, under this

A signature and a reading list: the passages chosen, in order, with a sign
each. That is small enough to send, exact to replay, and legible - every
weight traces to something the model chose to read. It still folds into
integer counters, so the swarm properties in witness.md carry over.

The other half of each pair can be any text at all. Nothing here needs one
member's writing compared with another's, so nothing is trained to tell
members apart.

## What the probes show

### Random steps cannot ride

The earlier probe (counter_net.mjs, random directions and sign votes, seven
documents) was told to hold the mine-to-other distance on a sine wave. With
one wave for every pair it rode along by swelling and shrinking everything
together, and learned nothing. With a separate phase per document it could
not keep up at all. Both results said the steps have to come from the data.

### Steps taken from the data can

The probe was `crawl.mjs`. The corpus is 4,484 prose documents of
4 KiB from MiniPile, standing in for FineWeb, which was not on disk. 800 are
held out and never read. Each of 128 peers takes one document as its
signature. The other 3,556 are the library.

The model is one table: 8,192 hashed trigram rows by 16 columns of integer
counters. A passage is the set of trigrams it contains, and its embedding is
the sum of their rows. A peer's loss is its mean distance from four signature
passages to four library passages it drew once and keeps as a ruler. Its wave
runs 25% above and below where that loss started, 128 ticks to a cycle.

Each tick, a peer more than 2% off its wave is offered eight fresh library
passages. It may step along one: add the difference between a signature
passage and that passage to the table, pushing the two apart or pulling them
together. Every peer steps on the same table. Every run replays backward to
the same table, bit for bit.

The score is taken on the held-out documents: how often a passage sits closer
to the other half of its own document than to a stranger's. Chance is 0.5.
The untrained table scores 0.612 and uses 15.2 of its 16 directions.

One wave for the whole swarm, six cycles:

| How a peer chooses | Miss | Ticks used | Held-out score | Directions |
|---|---|---|---|---|
| random: any passage on offer | 0.012 | 0.18 | 0.609 to 0.620 | 14.9 |
| fit: the one predicted to land nearest the wave | 0.011 | 0.13 | 0.616 to 0.625 | 14.7 |
| soften: push the nearest, pull the farthest | 0.013 | 0.19 | 0.610 to 0.617 | 15.4 |
| sharpen: push the farthest, pull the nearest | 0.013, then 1.13 | 0.19, then 0.89 | 0.680 at cycle 2, 0.625 at cycle 6 | 1.1 |
| lean: sharpen, among steps predicted to help | 0.012, then 0.27 | 0.16, then 0.73 | 0.649 at cycle 3, 0.582 at cycle 6 | 1.2 |
| reference: no wave, told which passages share a document | - | 1.00 | 0.757 | 1.0 |

Miss is the mean gap between a peer's loss and its wave, in units of the
loss at the start. The wave's height is 0.25.

What this says:

- **Riding works.** Steps taken from the data hold 128 peers within about 1%
  of the wave, and most ticks need no step at all.
- **Choosing makes riding cheaper.** A peer that picks the passage it needs
  takes about 30% fewer steps than one that takes whatever comes. It does
  not get cheaper from one cycle to the next.
- **A wave ridden well leaves nothing behind.** Under random, fit and soften
  the held-out score stays within 0.013 of the untrained table. The table's
  net movement is what a random walk of the same steps would give, or a
  little less. Pushes and pulls along different passages mostly neither
  cancel nor add up.
- **The one rule that leaves something runs away.** Sharpen lifts the score
  by 0.07 in two cycles, about half of what the reference gains. It does it
  by piling the table onto a single direction. Then the peers lose the wave
  and the score decays. Lean, which takes only steps predicted to help, holds
  the wave a cycle longer and ends the same way, below where it started.
- **The reference is weak.** It also ends on one direction. So one learned
  axis is worth 0.757 on this test, and what the table could hold across
  sixteen is unknown.

A second way of spreading a step over the columns (plain signs, `CODE=sign`)
gives the same picture in every row.

## Core and tendrils

Across a swarm, every peer rides from a different origin. Steps that many
peers take add up in the shared table; steps only one peer takes stay its
own. The prediction was a stable core with a tendril per peer. Give every
peer its own phase (`PHASE=own`) and the shape appears:

| | One wave | A phase per peer |
|---|---|---|
| Miss (fit) | 0.011 | 0.016 |
| Ticks used (fit) | 0.13 | 0.33 |
| Movement of held-out distances within a cycle | 0.33 | 0.01 to 0.02 |
| Cosine between two peers' net contributions | 0.000 | -0.001 |

With phases spread around the cycle, 128 peers each ride their own wave on
one table, and text that nobody holds barely moves. Each peer's movement sits
in rows no other peer is moving. That is a still core and separate tendrils.

What the numbers do not give:

- **The core holds nothing.** It is still because nobody moves it. It is the
  untrained table, and the held-out score says so (0.603 to 0.610).
- **A tendril is a leftover so far.** It keeps one peer on its wave. Nothing
  can be asked of it.

On scale. A simulated swarm is one table, so cost grows with the number of
peers and nothing else: about a thousand peer ticks a second on one core.
The limit is not compute. It is how much one peer's step moves another
peer's loss, and that already shows on 8,192 rows:

| | 128 peers | 512 peers |
|---|---|---|
| One wave: miss, ticks used | 0.011, 0.13 | 0.016, 0.28 |
| A phase per peer: miss, ticks used | 0.016, 0.33 | 0.022, 0.45 |
| Held-out score after two cycles (one wave, a phase per peer) | 0.622, 0.606 | 0.599, 0.594 |

Four times the peers still ride, but each works harder to hold its place,
and the table gets a little worse for text nobody holds.

Timing matters less than expected. When all 128 peers decide against the
same table before any step lands (`STALE=1`), the wave holds at a miss of
0.020, for nearly three times the steps. An earlier version of the probe
could not hold the wave at 128 peers at all (miss 0.1 to 0.2). It used raw
trigram counts and let a pull carry a coordinate through zero. Both were
changed at once, so which one mattered is not isolated. The likely one is
the counts: common trigrams put every step partly on the same rows.

One caution about clones. Peers that share a signature and differ only in the
example they hold are one model with a larger batch. What makes them a swarm
is that each has its own origin, and here its own phase.

## The gap

A wave says when to move and how far. It does not say what to learn. The
probe makes that concrete: held on the wave by a rule with no preference, the
table drifts and keeps nothing. Whatever is learned has to come from an
asymmetry between what is chosen on the way up and what is chosen on the way
down. The one asymmetry tried, by distance, feeds itself: far things are
pushed farther until one direction holds everything.

The wave does not stop that. It fixes one number per peer, the mean distance
to its ruler, and leaves the table free to take any shape that keeps the
number. So the wave is a pace, not a constraint on what is learned.

The open rule, restated: an asymmetry in what to read that adds up across
many directions and does not feed itself.

What it is for is also open. The best candidate so far: a model whose
provenance is complete, because it is nothing but a list of what it read.

## Prior-art anchors

From memory, not checked against sources.

- Learning with a phase that learns and a phase that unlearns, cancelling at
  equilibrium: Boltzmann machines, wake-sleep, contrastive Hebbian learning.
- An oscillating teaching signal, with the update read off at the wave's own
  frequency: Baldi and Pineda 1991; holomorphic equilibrium propagation 2022.
  The engineering name is a lock-in amplifier.
- Weights written as a signed list of examples: the dual form of a linear
  model, support vectors, the perceptron's update-only-on-need.
- Choosing the examples that steer a learner: machine teaching, active
  learning.
- Holding a loss at a level and not at zero: flooding (2020).
- Strengthening what is already strong until one direction wins: Hebbian
  learning and Oja's rule, and the decorrelating terms (Sanger's rule) that
  were added to keep several units apart.

## Cheapest next probe

Two changes to the probe (crawl.mjs, in git history), each a few lines:

- **A reference that does not collapse.** Until one exists, the gain to aim
  for is unknown. Keep the columns apart while pulling same-document passages
  together, and see what sixteen directions are worth on the held-out score.
- **A rule whose asymmetry does not feed itself.** One candidate: each column
  chooses its own passage, so the columns cannot all follow the same one.
  Another: the pull uses two passages of the signature, which is the one
  thing a peer knows goes together, and only the push reads the library.

If the second reference is no better than 0.757, the table is too small to
say anything and the test should change before the rule does.
