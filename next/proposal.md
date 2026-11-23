# Proposal: a memory the swarm holds

> Status: **path A's mechanism is built** (2026-11-22): the swarm memory,
> mixed into the ghost text; tabs keep the rooms they have been in and
> answer from them, weighted by room; test peers to try it (see CLAUDE.md,
> "Swarm memory"). Trust and corroboration are not built.
> Proposed 2026-11-21; supersedes the objectives in [witness.md](witness.md)
> and [crawl.md](crawl.md). The experiments ran in Node and headless
> Chromium on public data; their scripts were scratch and are not kept
> here.

## In one paragraph

Stop trying to grow intelligence in weights; the swarm cannot out-train a
datacenter. Grow it in **memory** instead. Every peer keeps some of the
community's text with a small index (a suffix array, about 100 lines of
plain JavaScript). The ghost text keeps its local model, and when the
swarm remembers something that ends the way your line does, what came
next is mixed into the model's guess. With nothing remembered, the ghost
text is exactly what it is today. Nobody holds the memory; it
gets better with every member and every day; every suggestion can name
the passage it came from; deleting a passage removes it for good; and the
peers who answer earn their say by predicting what people actually write
next. A GPU cluster cannot copy this, because the data is the community's
own, given on its terms, and the test is a future that has not been
written yet.

## What the experiments say

Data: Synthetic-Persona-Chat (21k two-person chats written by a language
model, very formulaic) and MiniPile (real web text, varied). The model is
the ghost text's own, SmolLM2-135M-Instruct, 8-bit, as on the site. "Top-1" is how often the
first guess is the next token; perplexity is lower-is-better.

| | Synthetic chat | Real web text |
|---|---|---|
| The ghost text's model alone, top-1 | 47.0% | 39.8% |
| Memory alone, 0.07M / 0.66M / 6.5M tokens | 50% / 59% / 63% | 20% / 22% / 26% |
| Model and memory mixed, top-1 | 65.7% | 41.3% |
| Model perplexity, alone and mixed | 8.9 to 4.5 | 23.5 to 21.3 |
| Perplexity gain, by memory size | grows every tenfold | 1%, 3%, 9% |

- **Memory pays most when it holds the community's own way of talking.**
  On text the model already knows (the web), it adds a modest gain that
  keeps growing with size. Infini-gram reports 47% top-1 on human text at
  1.4 trillion tokens; a swarm sits somewhere on that curve.
- **A sharded memory answers like a single one.** Under "the longest match
  wins, counts add", 100 shards gave the same answer as one index 949
  times in 1,000 (the rest: ties, and matches across the cuts).
- **It is cheap.** A peer's shard of 65k tokens indexes in 33 ms and takes
  0.4 MB; 6.5M tokens take 9 s and 39 MB. A lookup costs about 30 µs.
- **Trust by prediction works where voting fails.** Liars who claim the
  longest match and push a spam token wiped out both plain counting and
  median rank (0% correct, even with only 15 liars against 150 honest
  peers). Counting only peers whose own predictions beat a public
  word-frequency baseline, judged by everyone on what was actually said,
  held at 61.6%, the same as with no liars, and dropped each liar within
  its first prediction. Peers holding stories were dropped from chat rooms
  on their own.
- **Sneaky liars need a second rule; colluders need proof.** Liars who
  answer honestly and spam 2% of the time keep their trust (28% of
  positions spammed with 15 of them). One peer, one vote, with the longest
  match counted only when two trusted peers reach it, cut that to 3.9% at
  no cost to honest accuracy. Liars who spam together get through every
  time (1.8%): they vouch for each other. That is what path C is for.
- **Choosing what to keep can be learned.** Reading lists of 64 rooms,
  bred and selected for predicting held-out chat, beat the best of as many
  random lists, and the gain held on rooms selection never saw (about 13%
  lower perplexity than a random list). Selection stalled after five
  generations as the lists converged; real selection needs diversity.

## Three paths

### A. The Library (recommended)

The swarm's memory, mixed into the ghost text. The ghost text is written
into your own line, as INK@CORE; the local model keeps writing it, and the
memory only adds to its guess.

- **It starts from nothing and still works.** The weight given to memory
  is zero until something matches, so with no community the ghost text
  behaves exactly as now. That is the point of keeping the model: it helps
  a small room write, what the room writes becomes the memory, and the
  memory's share grows as the room does.
- Each peer keeps a shard: what it wrote, what its rooms said, and what it
  chose to keep, the way it keeps radio songs (OPFS, re-seeded at load).
  The stack's seeder keeps a large, always-on shard, as it already does
  for the radio.
- The writer mixes the swarm's answer into its model's scores before
  choosing (the worker's `pick()` already takes scores). The weight given to memory
  grows with match length, as fitted: none for one token, 0.3 to 0.6 for
  medium matches, 0.85 past twelve.
- Trust is earned by predicting, scored by everyone on public chat; one
  peer, one vote; long matches need two trusted peers.
- Learning is placement: passages that people accept (Tab) or that answer
  often are kept by more peers; unused ones fade. The library curates
  itself, like a swarm deciding which pieces to seed.

Gives: better ghost text that sounds like this community, with every
suggestion traceable to a passage, and forgetting by deletion.

**PEN as the memory's voice (optional).** PEN does not speak today. The
memory could give her a reason to, without /call: when what is being said
matches something the room said before at length, PEN recalls it, with
where it came from. Rare by construction (only long matches), and
rate-limited. This is the same memory, used to remember out loud rather
than to finish your line.

### B. The Daemons

Living voices. A daemon is a reading list: a set of passages from the
library, spoken through an unbounded-order chain. Daemons already name
every visitor; here they would talk in chat, deterministically by clock,
so every browser prints the same line and nothing is sent. People's
responses are the fitness: replies, quotes, Tab-acceptances of a daemon's
words. Daemons breed (merge reading lists) and mutate (swap passages).
Over months the population drifts toward what the community answers.
Electric Sheep (1999, still running) is the precedent: a distributed
screensaver whose animations are bred by viewers' votes.

Gives: something that is alive, belongs to the place, and cannot be
emulated without the place. Risk: it fills chat, which is why /call and
the random replies were removed; it needs a rate and a room of its own.

### C. The Witness

Certainty instead of trust. A peer commits to its shard (a Merkle root,
or a torrent's info hash) before the conversation exists. An answer
carries a proof against that commitment. Over a suffix array, a Merkle
tree can prove not only that a passage is there but how many times: the
two ends of the matching range, and their neighbors that do not match.
Colluders cannot prove matches their committed text does not hold, and
text committed before a conversation cannot contain its future. Proof
size is a few dozen hashes. The pieces exist (authenticated key-value
stores prove membership and absence over sorted data); the combination
does not appear in the literature. A further step, hiding which peer
answered (zero-knowledge membership proofs, as in Semaphore), protects
members and also shields abusers, and costs seconds per proof in a
browser: too early, and to be decided on purpose.

Gives: answers anyone can check, and the defense against collusion that
A lacks.

## How they fit

A stands alone and is the base. B reuses A's indexes for a different
purpose. C hardens A. A suggested order: A, then C's commitments (cheap),
then B if the room wants it.

## Constraints, answered

- **Browser, plain JavaScript.** The index, lookup and vote are typed
  arrays and binary search; nothing to install.
- **Peers are slow and expensive.** An answer is a match length and a few
  candidates, tens of bytes. Asking for spans (the next several tokens)
  cuts round trips; ghost text can ask ahead while the visitor types. At
  first a query goes to the 20-30 peers a tab is connected to anyway;
  larger swarms need routing by hashed n-grams (who holds what), which is
  the main engineering problem at scale.
- **Sticky, long-term.** The memory is as permanent as the peers who keep
  it, and the seeder keeps a copy. Trust accumulates across rooms and
  days. The model improves only by members adding text and by the swarm
  learning what to keep: slow, and it never has to start over.

## Risks

- **Synthetic chat flatters the memory.** Real chat in The Source sits
  between the two columns above; only the site can say where.
- **Copying.** An unbounded chain repeats long spans word for word: whose
  words get repeated, and with what credit, is a design question as much
  as a technical one.
- **Queries reveal what you are typing** to the peers asked. Hashed n-grams
  help; short ones can be guessed. Asking only for spans already said in
  the room, or only on pause, limits it.
- **Trust ranks predictors.** It ranks shards by how well they predict, not
  people by worth, but it is a ranking, and witness.md said not to build
  those. Worth keeping invisible.
- **Selection collapses.** Bred reading lists converged in five generations
  in the toy. Fitness from many different people is the hope, not a
  result.

## First steps, if A

1. ~~The index and the vote as a module in `src/js/`, tested under Node.~~
   Done: `memory.js`, in characters rather than tokens, so peers need no
   tokenizer and any language works.
2. ~~Ask the room's peers over the chat wires (a second BEP 10
   message).~~ Done: `recall.js`. ~~Each tab indexes its own rooms'
   history and answers too.~~ Done: `library.js`, with the vote weighted
   by room (the room asked through counts fully, others for 0.3).
3. ~~Mix into the writer's guesses.~~ Done, and the writer asks again as it
   writes. Still to do: measure accepted ghost text (Tab) with and without
   the swarm, per room. That is the real test.
4. Trust scoring and corroboration (one peer, one vote is in), then the
   seeder's shard.

## Sources

- Infini-gram (Liu et al., COLM 2024): arxiv.org/abs/2401.17377
- Electric Sheep (Draves, 1999): en.wikipedia.org/wiki/Electric_Sheep
- Authenticated key-value stores (Merkle trees over sorted data prove
  membership and absence): arxiv.org/pdf/1904.12068
- Neighbors, for contrast: Petals and Pooled (neural layers split across
  peers), De-DSI (decentralized retrieval, arxiv.org/abs/2404.12237),
  ZKPROV (zero-knowledge dataset provenance, arxiv.org/abs/2506.20915).
- From memory, unchecked: kNN-LM (2020), RETRO (2022), cache language
  models (1990), Prediction by Partial Matching (1984), Semaphore, and the
  median-based aggregation literature (coordinate-wise median and
  geometric median in robust distributed learning; median rank
  aggregation; majority judgment).
