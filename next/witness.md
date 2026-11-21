# Witness: a swarm of twins that measures contrast

> Status: **design sketch, one probe run, purpose unresolved** (2026-11-18).
> Nothing is built. The mechanism holds up; the objective it is pointed at
> does not - see "The objective is the problem" under Honest unknowns. The
> probe is [counter_net.mjs](counter_net.mjs); the build order is
> [roadmap.md](roadmap.md); sources are
> [evolution_strategies_paper.md](evolution_strategies_paper.md) and
> [webtorrent.md](webtorrent.md).

## The one line

Every member's browser holds the same tiny network. Each browser tests that
network against its own member's writing, and the only thing that crosses the
wire is a seed and a vote. The network that results belongs to nobody, moves
only as fast as the swarm agrees, and has one job: keep its members
distinguishable.

## Where the idea comes from

*Corpus Christi* describes a judge built from one pile, set to rank, and what
ranking at scale does to the people ranked: the variance is handed over. It
closes on a request - be the validation set, score what gets built against the
things that were never in it, call the distance the error. This design takes
that request as a specification.

| | The contest's system | This one |
|---|---|---|
| Entry | a text submission, licensed to the organizer | a text submission, seeded by its author |
| The reader | one judge, trained on the pile | N copies of one network, one per member |
| What it learns | more like these, fewer like those | which passages belong to the same hand |
| Convergence | the failure nobody measures | the loss itself |
| Held-out data | none | every member holds some, and it never votes |
| The twin | built from all of your data, on somebody's GPU | built in your tab, from your own document |
| Output | a ranking | a map, and a distance |

There is no winner here and no way to produce one. The network cannot say a
document is good. It can only say how far a document sits from the others.

## The pieces that were on the table

Six threads went in. Each one lands somewhere specific:

- **GUN's temperament** - every value its own event, the whole network always
  trying to become consistent. Kept, and made exact: see *counters* below.
- **Sticky, not immutable.** A value that changes only by swarm agreement. This
  turns out to be the same object as the shared network.
- **WebTorrent.** Used unmodified, for what it is good at: finding peers and
  moving blobs. No fork.
- **A Siamese network with N twins**, entered by a text signature. This is the
  center of the design.
- **Slow integration.** A step is taken only after it is tested, and new data
  is fetched only when it can teach something.
- **Faking the chat bots.** Possible with zero bytes on the wire.

## Mechanism

### Counters

The network's weights are integers. A weight's value is its counter times a
fixed unit. The swarm's entire shared state is that vector of counters.

A **record** is a seed, a vote of +1 or -1, and its author's signature. The
seed expands, through an integer-only generator, into a +1 or -1 for every
weight. Applying a record adds `vote * direction(seed)` to the counters.

Integer addition commutes. So:

- Two browsers that have seen the same set of records hold the same network,
  bit for bit, in whatever order the records arrived. No rounds, no leader, no
  clock, no conflict resolution - there is nothing to resolve, because nothing
  is ever overwritten.
- A late joiner needs the genesis seed and the records. It can replay them
  backward if it likes.
- Browsers disagree about `Math.tanh` in the last bit. It does not matter. A
  browser's own arithmetic only decides its vote; the vote is what enters the
  state.

This is the GUN property that was worth keeping - one small event per value,
constant convergence - with last-write-wins removed.

### Sticky

A record moves each weight by one tick. One member cannot drag the network
anywhere: a direction persists only while votes keep landing on its side, and
a member who lies cancels exactly one member who does not. Votes per identity
are rate-limited, so the pace of the whole network is a property of the rule.

The same construction covers the small shared values the site needs (the
snapshot pointer, the station list, the tracker list): each member holds one
current vote per key, and the value is the plurality. Changing it takes a
plurality changing its mind. That is the whole of sticky.

### The vote

A browser draws a seed, shifts its copy of the network a little way along that
direction and then the same distance against it, and scores both on its own
member's text. It votes for the better side. If the difference is inside its
own noise, it casts nothing.

The score is contrast: two passages from my document should sit closer
together than a passage of mine and a passage from someone else's document
that I hold.

Every step is a trial with a result, not a gradient accumulated over
everything that passed by. Most trials end in nothing.

### The witness

The last quarter of every member's document never votes. It exists to measure:
can the network, trained only by other passages, still place this unseen text
with its author? Each member is a row and also a held-out set, and the number
each browser shows its member is measured there.

### Slow integration

A browser works a small fixed set - its own document and a few others. It
fetches another member's document only when two things are true: its own
witness score has stopped moving, and the candidate currently sits *near* it
in the network's own space. A near neighbor is the only new data that can
teach this network anything about me. Everything else is skipped.

### The twin

The shared counters are the part everyone holds: the prior, the one body. A
member's twin is that prior plus a small private residual trained in their own
tab on their own text, which is never published. This is the split Praxis
already draws between a resident bias and a streamed variance, with one
change - here the variance stays home.

What a member reads off their twin: their nearest members, their distance from
the swarm's center, their distance from a reference document written by a
stock model to the same prompt, and the swarm's mean pairwise distance as a
live number in the ticker. That last number is the swarm's variance. When it
falls, the members are converging, and the site says so.

### Daemons

`daemon.ts` already builds a Markov chain to name each visitor. Extended to a
variable-order chain over a member's document, the daemon speaks. Documents
are public inside the swarm, so any browser can run any member's daemon
locally, seeded by member and UTC slot - the same world-clock trick the Praxis
arena uses. Every browser prints the same line at the same moment and nothing
is sent. The chat fills without a single bot on the network.

It is also a game with a score. The twin tries to attribute each daemon line
to its member. A daemon the swarm recognizes as its author is a working twin
of that author's voice, validated by peers who were never given the author's
data. A small generator trained against the encoder can replace the chain
later; nothing else changes.

### Transport

The founding document's infohash is the room. Three layers, each doing one
thing:

- **Finding peers.** Browsers have no DHT; a WebSocket tracker is the only way
  they meet. So there is one small always-on thing, a tracker, and it replaces
  both GUN relays. Public trackers serve as fallbacks.
- **Records.** A thin client speaks the WebTorrent tracker protocol and opens
  plain WebRTC data channels. A tab holds about ten peers comfortably, so
  records hop across a partial mesh.
- **Blobs.** Member documents and counter snapshots are small enough to fetch
  by hash over the same channels. WebTorrent itself, unmodified and loaded
  only when asked for, carries the radio, with web seeds on static hosting so
  nothing dies when the last tab closes.

WebTorrent stays at the edge on purpose. It works, but its recent history is
automated dependency bumps, and its WebRTC layer rests on a one-maintainer
fork of an abandoned package. Mutable torrents were never implemented in it,
so sticky has to be ours either way. Measurements and sources are in
[webtorrent.md](webtorrent.md).

## What the probe shows

`node next/counter_net.mjs <documents>` simulates the mechanism in
plain JavaScript: a 33,824-weight encoder over hashed character trigrams, one
simulated peer per document, records gossiped with random delay and delivered
in a different order to every peer.

Run on seven stand-in documents (book chapters, design notes, two manual
pages; chance is 0.143):

| | Result |
|---|---|
| Witness accuracy | 0.280 at genesis, 0.607 after 42,000 records |
| Witness margin | -0.125 at genesis, +0.086 after 42,000 records |
| Agreement | seven peers and a late joiner replaying the log backward: one digest |
| Two of seven peers inverting every vote | 0.488 at 16,800 records, against 0.560 honest |
| One core | about 470 trials per second, about 3,800 record applies per second |
| Log | 5 bytes a record unsigned; 205 KiB for all 42,000 |

What this does and does not say. The mechanism works: order-free agreement is
exact, learning happens through sign votes alone, and liars slow it without
stopping it. It says nothing yet about style. These documents differ in genre
and are easy to tell apart, the curve is noisy (168 witness passages), and
seven peers is not a swarm.

## Prior art

Sending seeds and scalars in place of gradients is Salimans et al. 2017.
arXiv 2511.16652 (EGGROLL) scales it with low-rank perturbations and shows
that an integer-only model can be trained this way, at a large cost in
compute; its setting is a trusted, synchronous cluster. SeedFlood (2026)
floods seed-scalar pairs with no server, over a fixed graph of trusted nodes.
DeComFL replays missed pairs for late arrivals. One browser implementation of
EGGROLL exists, in plain JavaScript, single tab. Notes and citations are in
[evolution_strategies_paper.md](evolution_strategies_paper.md).

What differs here: integer counters and sign votes, so the state is order-free
and every record's pull is bounded; open membership; and an objective scored
on text the scorer keeps.

One warning from the paper applies directly. It reports that a population of
two underperforms when training from scratch. Every record here is a
population of two. The bet is that many small records arriving out of step
behave like one large population spread over time. The probe is consistent
with that bet and does not settle it.

## Honest unknowns

- **Speed.** Voting on random directions costs roughly one factor of the
  weight count against a gradient step. The probe learns, slowly. Whether that
  pace holds up with hundreds of members and a harder task is unmeasured. The
  fallback keeps the substrate and changes the record: a member computes an
  exact local gradient and votes on its few largest coordinates.
- **Sybils.** A record's influence is bounded; the number of identities is
  not. A text submission is a cost, not proof of a person. Rate limits and
  vouching are the tools. A coin is not.
- **Style or topic.** With one document per member, the network may learn what
  a document is about, not how its author writes. More text per member, or
  scoring on function words alone, would separate the two.
- **The objective is the problem.** A network trained to tell members apart
  by their writing is an authorship attribution model, and every browser
  holds a copy. Anyone can run it over text from anywhere and ask which
  member wrote it, or whether two accounts share a hand. Each fix listed
  here for making it work better (more text per member, style over topic)
  makes it better at exactly that. This cuts against the brand's own
  arrangement, that the author could be anyone. The counters, the votes, and
  the transport do not depend on this objective. The objective should be
  replaced or the note should be shelved.
- **Mesh size.** A browser tab holds tens of peer connections, not thousands.
  Records must hop.
- **Cost of applying.** Messages are tiny, but every browser expands every
  record across every weight. That bounds weight count times swarm record
  rate. Low-rank directions, as in the paper, are the way out if it binds.
- **Novelty.** The search found no open, serverless swarm trained this way,
  and nothing on contrastive objectives under this kind of training. Three of
  the five research threads were cut short to save budget (shared-state
  alternatives, in-browser runtimes, authorship methods), so that is a weak
  claim.

## Falsifiers

- Witness accuracy does not rise above its starting value within a number of
  records a small swarm could produce in a day.
- The contrast it learns is topic: accuracy collapses when members write to
  the same prompt.
- A tenth of the members voting adversarially is enough to stall it.

## What I would not build

- A fork of WebTorrent. Nothing here needs one.
- A token, a chain, or anything that prices a vote.
- A language model in the tab, as the first thing. The daemon needs a chain
  and a clock.
- Anything that ranks.
