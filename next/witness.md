# Witness

*On a swarm of identical twins, why it was set aside, and what it might become.*

> Status: withdrawn. A sketch from 2026-11-18, with one probe; nothing was built. The machinery held up, and what it was aimed at did not. Followed by [crawl.md](crawl.md), then [proposal.md](proposal.md). The probe and its research notes are in git history, at commit 6cd0317. A turned-around version, an authorship check only the author can run, is sketched below (2026-11-26; not built, not tested).

---

## The Request

*Corpus Christi*, the contest entry in `../rift`, describes a judge built from one pile of text and set to rank, and what ranking at scale does to the people ranked. It closes on a request: be the validation set. Score what gets built against the things that were never in it, and call the distance the error.

This note took that request as a specification.

What if the reader were not one judge, but many identical copies of one small network, one in each member's browser? What if each copy were tested against its own member's writing, and the only thing that crossed the wire were a coin flip and a vote? The network would belong to nobody, move only as fast as its members agreed, and have one job: keep its members distinguishable from one another.

There would be no winner, and no way to produce one. The network could never say a piece of writing was good, only how far it sat from the others.

| | The contest's judge | This one |
|---|---|---|
| Who reads | one judge, trained on the pile | a copy of one network in every member's browser |
| What it learns | more like these, fewer like those | which passages belong to the same hand |
| Everyone coming to sound alike | the failure nobody measures | the very thing it measures |
| Writing held back | none | every member keeps some back, and it never votes |
| What comes out | a ranking | a map, and distances |

---

## A Tally Everyone Keeps

The heart of the design was a way for thousands of browsers to share one network with no leader, no rounds and no clock.

Picture a tally board. Every vote is a mark: one step up, or one step down. Marks can arrive in any order, and two people who have seen the same marks hold exactly the same count. Nothing is ever overwritten, so there is never anything to settle when two marks arrive at once.

The network's weights would be such tallies, in whole numbers. A vote would be a short random seed, a +1 or a -1, and its author's signature. The seed expands, the same way in every browser, into a step up or down for every weight, and applying the vote adds that step to every tally. Adding whole numbers does not care about order, so every browser that has seen the same votes holds the same network, bit for bit. A newcomer needs only the starting seed and the votes. And browsers that disagree in the last digit of some calculation do not matter: a browser's own arithmetic only decides its vote, and only votes enter the shared state.

That was the one thing worth keeping from GUN, the database behind the site's previous version: every value its own small event, always converging, but with "the last write wins" taken out.

**Sticky.** A vote moves each weight by one tick, so no single member can drag the network anywhere. A direction lasts only while votes keep landing on its side, and a liar cancels exactly one honest member. With votes rate-limited per member, the pace of the whole network is set by the rule. The same trick would cover the site's few shared settings: each member holds one vote per setting, the most-voted value wins, and changing it takes a majority changing its mind.

---

## How a Browser Votes

A browser draws a seed, nudges its copy of the network a little way along that direction and then the same distance against it, and scores both on its own member's writing. It votes for the better side. If the difference is within its own noise, it casts nothing, and most trials end in nothing.

The score is contrast: two passages from my writing should sit closer together than a passage of mine and a passage of someone else's.

The last quarter of every member's writing never votes. It is the *witness*. Can the network, trained only on other passages, still place this unseen text with its author? That number is what each browser would show its member.

A browser would read only a few other members' writing, and fetch another's only when its own witness score had stopped improving and the newcomer sat close to it: a near neighbor is the only new writing that could teach the network anything about me.

Each member would also have a private twin: the shared network, plus a small correction trained in their own tab on their own text, never published. From it they could read their nearest members, their distance from the swarm's center, and the swarm's average distance between members, a live measure of whether everyone is coming to sound alike.

And the daemons, which already give each visitor a name from a chain of what-follows-what, could speak. Every browser would run a member's daemon from that member's writing, by the clock, so every browser prints the same line at the same moment and nothing is sent. The twin would try to guess whose daemon spoke; a daemon the swarm recognized would be a working copy of its author's voice.

---

## What the Probe Showed

A simulation in plain JavaScript (a small network over three-letter fragments of text, one simulated peer per document, votes delivered in a different order to every peer) ran on seven stand-in documents:

- **Agreement was exact.** Seven peers, and a latecomer replaying every vote backward, all ended with the same network.
- **It learned from votes alone.** Placing unseen passages with their own document went from 28% to 61% of the time, where chance was 14%.
- **Liars slowed it without stopping it.** With two of the seven peers always voting the opposite way, it reached 49% where honest peers had reached 56% by the same point.

It said nothing yet about style. The seven documents differed in kind and were easy to tell apart, and seven peers is not a swarm.

---

## Why It Was Set Aside

A network trained to tell members apart by their writing is an authorship detector, and every browser would hold a copy. Anyone could run it over text from anywhere and ask which member wrote it, or whether two accounts share a hand. Every improvement on the list (more text per member, style over topic) would make it better at exactly that. It cuts against the site's own arrangement: that the author could be anyone.

The tallies, the votes and the transport did not depend on that goal. So the goal was dropped, and the machinery moved on to the next note.

---

## What Survived

- **The transport.** The note asked for chats as torrents, chat messages on the torrent connections, a tracker to find peers in place of GUN's relays, and the radio on WebTorrent. The current version built all of it.
- **The tallies** went on to [crawl.md](crawl.md), which kept the machinery and looked for a better goal.
- **Daemons speaking by the clock** became path B of [proposal.md](proposal.md).
- **What not to build**, which still stands: a fork of WebTorrent; a token, a chain, or anything that puts a price on a vote; anything that ranks. (It also said not to start with a language model in the tab. The site has one now, for the ghost text, and it came after the chat and the radio.)

---

## Turned Around

*Added 2026-11-26, from the user's idea.*

The objection above is about who can ask. A detector that every browser holds answers "who wrote this?" for anyone, about anyone. Turn the question around, and it changes character: "did *I* write this?" Only the person holding the writing can ask that. Nobody can sign into the swarm as someone else and check for their work, because the key is the writing itself, kept at home.

That is this note's private twin, without the shared network that caused the trouble. Nothing is trained to tell members apart, and nothing is published that could be pointed at a stranger's text. The use is plain: did an AI trained on my writing produce this? Something like a takedown notice, but one where the author stays anonymous until they choose to act.

### Where the Privacy Comes From

Mostly from the private writing, not from anything clever on the wire. If you find a suspicious text, comparing it with your own writing happens on your own machine, with no swarm at all.

Sealed questions ([private-memory.md](private-memory.md)) matter when the pile to search belongs to someone else. Searching it in the open would show its holder which text you were looking for, and so that you are its author. Sealed, the search says nothing about you. You stay anonymous through the whole search, and the first time you identify yourself is the claim itself, if you file one.

For writing you have published, anyone can already compare a text against it. This adds no new danger there, as long as no shared detector is published.

### What It Could Catch

**Copying.** Long passages reproduced word for word, or nearly. As far as we understand it, this is what a takedown claim actually covers: copyright protects the expression, not the style. And it is what the swarm memory already does ([proposal.md](proposal.md)). Its index finds the longest stretch of your writing that a text repeats, and the proposal's measure gives a score: how much better the text is predicted by the model with your writing as its memory than by the model alone. A text that merely sounds like everyone barely moves that score; a text that borrowed your sentences moves it a lot.

**Style.** Much weaker. A large model blends millions of writers, so training on yours rarely makes it sound like you, unless someone asks it to imitate you. A short text carries little style to measure. And telling from outputs alone whether a model was trained on something is unreliable; the strong methods need the model's own probabilities, which its owners rarely share.

**Canaries.** The cleanest fit for "only I hold the key". Plant a few unique, unguessable phrases in what you publish, and keep the list private. If a model ever produces one, that is close to proof it read your text, because nothing else could have produced it. Sealed questions would let you check the swarm for your canaries without saying them out loud, since a canary said out loud is spent, and points back to you.

### What It Lacks

A pile to search. The swarm's memory holds the chat and a few chosen projects, not what AI systems write across the web. Sweeping for your writing needs someone to hold a large body of machine-written text and answer sealed questions about it: a crawl, of the kind [crawl.md](crawl.md) circled without building. Without one, the check works on texts you find yourself, which you can check at home anyway.

Open questions:

- **Paraphrase.** The memory matches characters exactly. A model that reworded your passage slips past it; catching near copies needs a looser match, which also catches more innocent ones.
- **Common ancestry.** A shared quotation, a stock phrase, or a source you both copied all look like copying. The score needs a baseline of how often a phrase turns up anywhere, which the model alone gives only roughly.
- **Canaries that survive.** Training pipelines filter text that looks odd, and drop repeats. A canary has to be unguessable yet read as ordinary writing, and sit where it will be collected.
- **Evidence.** What a score, or a reproduced canary, is worth to a host or a court is a legal question, not a technical one.
- **Who holds the pile**, and why they would answer.

The first test, when it comes: a corpus of someone's writing; texts that copy it, paraphrase it, or only share its subject; and the memory's score on each.

---

## Questions It Left Open

- **Speed.** Voting on random directions is far slower than computing exactly which way to move. Whether it keeps pace with hundreds of members and a harder task was never measured.
- **Fake members.** One vote's pull is bounded; the number of identities is not.
- **Style or topic.** With one document per member, a network may learn what someone writes about, not how they write.
- **Mesh size.** A tab holds tens of connections, not thousands, so votes would have to hop.
- **Novelty.** The search found no open, serverless swarm trained this way, but three of its five threads were cut short.

---

## The Numbers

The probe's network: 33,824 weights over hashed three-letter fragments. Seven documents (book chapters, design notes, two manual pages).

| | Result |
|---|---|
| Unseen passages placed with their document | 28% at the start, 61% after 42,000 votes (chance: 14%) |
| Margin between own and other documents | -0.125 at the start, +0.086 after 42,000 votes |
| Agreement | seven peers, and a latecomer replaying backward: one network |
| Two of seven peers always lying | 49% at 16,800 votes, against 56% when honest |
| One processor core | about 470 trials, and 3,800 votes applied, per second |
| The log of votes | 5 bytes a vote unsigned; 205 KiB for all 42,000 |

---

## Prior Art

Sending seeds and scores instead of gradients is Salimans et al., 2017. EGGROLL (arXiv 2511.16652) scales it, and trains an all-whole-number model this way, at a large cost in computing, in a trusted, synchronized cluster. SeedFlood (2026) floods seed-and-score pairs with no server, among trusted nodes. DeComFL replays missed pairs for latecomers. What differed here: whole-number tallies and one-step votes, so the order never matters and every vote's pull is bounded; open membership; and a goal scored on text the scorer keeps.

One warning from EGGROLL applied directly: a population of two does poorly when training from scratch, and every vote here is a population of two. The bet was that many small votes arriving out of step behave like one large population spread over time. The probe was consistent with that bet, and did not settle it.

For the turned-around version, from memory and not checked against sources: planted canaries, and measuring how much a model memorized them (*The Secret Sharer*, Carlini et al., 2019); data watermarks, for proving that a model was trained on a text (Wei et al., 2024); and detecting training data from a model's own probabilities (Min-K%, Shi et al., 2023).
