# A Memory the Swarm Holds

*On growing intelligence in what a community remembers, not in what a machine was trained on.*

> Status: the first of three paths, the Library, is built: the ghost text asks the chat what it remembers. Trust earned by predicting is not built. Proposed 2026-11-21, after [witness.md](witness.md) and [crawl.md](crawl.md); the private version, for the extension's ghost on other sites, is [private-memory.md](private-memory.md).

---

## The Town's Notebooks

Picture a town where nobody is a great writer, but everybody keeps a notebook of things they have heard said. You start a sentence at the market, and someone nearby says: "Funny, I heard almost exactly that last week. It went on like this." Nobody in town is especially clever. Together, they remember a great deal, and what they remember is the town's own way of talking.

That is the whole proposal.

A swarm of browsers cannot out-train a datacenter. It will never have the chips, the power, or the data to grow a better model in weights. But it can out-remember one, on its own ground. A datacenter's model knows how the internet talks in general. It does not know how this chat talks: what was said in it yesterday, its running jokes, its names. The people who were there do.

So: stop trying to grow intelligence in weights, and grow it in memory instead.

---

## How It Works

The ghost text keeps its small model, running on the visitor's own device. The model guesses how a line goes on, a piece at a time, as it always has.

Alongside it, every peer keeps some of the community's text, with an index that can find, in a fraction of a millisecond, the longest stretch of that text ending the way your line ends, and what came after it. (The index is a *suffix array*: every position in the text, sorted by what comes before it, so that matching endings sit side by side. It is about a hundred lines of plain JavaScript.)

As you type, your browser asks the peers it is connected to: has anyone seen a line that ends like mine? Each one answers with how long its match is, and what followed. The answers are pooled, and what came next is mixed into the model's own guess. A long match counts for a lot, a short one for little, and anything under eight characters for nothing.

Three things follow from this design, and they are the reasons for it.

**It starts from nothing and still works.** With nothing remembered, the memory's share is zero, and the ghost text is exactly the model's. A brand-new chat is no worse off than before. The model helps a small chat write, what the chat writes becomes the memory, and the memory's share grows as the chat does.

**Nobody holds it.** The memory is spread over everyone who was there. It gets better with every member and every day, and no single machine can take it away.

**It can be accounted for.** Every suggestion comes from a passage someone said, which could be named. And forgetting is deletion: remove a passage, and it is gone for good, which no trained model can promise.

One more is a hope rather than a result: **peers would earn their say by predicting.** A peer whose memory keeps guessing what people actually write next deserves more weight than one whose memory does not. A datacenter cannot copy that, because the data is the community's own, given on its terms, and the test is a future that has not been written yet.

---

## What the Experiments Said

Before building anything, we tried the idea on public data, with the ghost text's own model.

**Memory pays most when it holds the community's own way of talking.** On formulaic chat (two-person conversations written by a language model), mixing in the memory lifted how often the model's first guess was right from 47% to 66%. On varied web text, which the model already knows well, the gain was small (40% to 41%), but it kept growing as the memory grew. Real chat in The Source sits somewhere between the two.

**A memory split across many peers answers like one.** With the text cut into 100 pieces, each indexed on its own, and the rule "the longest match wins, and equal matches add up", the pieces gave the same answer as one big index 949 times in 1,000. The rest were ties, and matches that crossed a cut.

**It is cheap.** A peer's share of 65,000 words and word pieces indexes in 33 milliseconds, and a lookup takes about 30 millionths of a second.

**Voting fails against liars; trust by prediction does not.** Fifteen liars among 150 honest peers, each claiming the longest match and pushing a spam word, wiped out plain counting entirely: not one right answer. Counting only the peers whose own predictions had beaten a simple baseline, judged by everyone against what was actually said next, held accuracy where it was with no liars at all, and dropped each liar after its first prediction.

**Sneaky liars need a second rule; liars working together need proof.** Liars who answer honestly and spam only 2% of the time keep their trust. Giving each peer one vote, and counting the longest match only when two trusted peers reach it, cut the positions they spoiled from 28% to 3.9%, at no cost to honest accuracy. Liars who spam *together* still get through every time they try: they vouch for each other. That is what the third path below is for.

**What to keep can be learned.** Reading lists of 64 chats, bred and selected for how well they predicted chat they had not seen, beat random lists by about 13%, even on chats the selection never saw. But selection stalled after five generations, as the lists all came to look alike. Real selection needs variety.

---

## Three Paths

### A. The Library

The swarm's memory, mixed into the ghost text, as described above. This is the base, and it stands alone.

- Each peer keeps a share: what it wrote, and what its chats said.
- Always-on servers keep large shares (since built: the library servers, which read chosen open-source projects).
- The memory's weight grows with the length of the match.
- Trust is earned by predicting, scored by everyone on public chat; one peer, one vote; long matches need two trusted peers.
- Learning is placement: passages that people keep with Tab, or that answer often, would be kept by more peers, and unused ones would fade. The library would curate itself, the way a swarm decides which pieces of a torrent to keep seeding.

A smaller idea rides along: **PEN as the memory's voice.** PEN no longer speaks in chat. The memory could give her a reason to, rarely: when what is being said matches, at length, something the chat said before, PEN recalls it, and says where it came from. The same memory, used to remember out loud instead of finishing your line.

### B. The Daemons

Living voices. A daemon would be a reading list: a set of passages from the library, spoken through a simple chain of what tends to follow what. Daemons already name every visitor (the ticker's `daemon`); here they would talk. Every browser would run them by the clock, so every browser prints the same line at the same moment, and nothing is sent. People's responses would be their fitness: replies, quotes, words kept with Tab. Daemons would breed (merging reading lists) and mutate (swapping passages), and over months the population would drift toward what the community answers.

The precedent is Electric Sheep, a screensaver running since 1999, whose animations are bred by its viewers' votes.

It would give something alive, that belongs to the place and cannot be copied without the place. The risk is that it fills the chat, which is why PEN's replies in chat were removed; it would need a slow pace and a chat of its own.

### C. The Witness

Certainty instead of trust. A peer would commit to its share of the memory, publishing a fingerprint of it (a torrent's info hash would do), before any conversation happens. Each answer would then carry a short proof against that fingerprint: not only that the passage is there, but how many times. Liars working together could not prove matches their committed text does not hold, and text committed before a conversation cannot contain its future. A proof would be a few dozen fingerprints long.

The pieces exist; the combination does not appear in the literature. A further step, hiding which peer answered, would protect members and also shield abusers, and costs seconds per proof in a browser: too early, and something to decide on purpose.

### How They Fit

A is the base. C hardens it against liars working together. B reuses A's memory for another purpose. The suggested order: A, then C's commitments (they are cheap), then B if the community wants it.

---

## What Happened Next

Path A was built, step by step:

- **The memory** (`memory.js`), in characters rather than word pieces, so peers need no model to split text and any language works.
- **Asking the chat** (`recall.js`): questions and answers travel beside the chat's messages, to every peer connected.
- **Tabs remember** (`library.js`): every tab keeps the newest lines of the chats it has been in, and answers from them. A line from the chat the question came through counts fully; lines from other chats count for less. Careless lines (mashed keys, shouting, repeats) are not kept, and careful ones count for more (`quality.js`).
- **Library servers** (`containers/node/peers.js`): always-on peers that read chosen open-source projects and answer from them.
- **The ghost never waits for the swarm** (2026-11-25/26): the first guess goes ahead at once, and a strong answer that comes late and disagrees rewrites it, once.
- **Sealed questions** for the browser extension, which writes in other sites' fields, where an open question would show strangers what you type: [private-memory.md](private-memory.md).

It does what the experiments promised. In a browser, with two peers holding a collection of children's stories, the ghost reproduced the stories' own next 30 characters 76% of the time; the model alone, 7%. In a chat with a library server holding the old site's archive, "The Source Codes describe an interdimensional" went on with the old site's own lore, where the model alone wrote something generic.

Not built:

- **Trust by prediction**, and counting long matches only when two trusted peers agree. Each peer has one vote, and that is all.
- **Placement**: popular passages spreading to more peers, unused ones fading.
- **The real test**: whether people keep more ghost text with the swarm than without it, chat by chat.
- Paths B and C.

---

## Risks

- **Formulaic chat flatters the memory.** The big gain came from chat written by a model. Only the site itself can say where real chat falls.
- **Copying.** A memory repeats long passages word for word. Whose words get repeated, and with what credit, is a design question as much as a technical one.
- **Questions reveal what you are typing** to the peers asked. In the chat, that is accepted: the chat is public anyway. In other sites' fields, the questions are sealed ([private-memory.md](private-memory.md)).
- **Trust ranks predictors.** It would rank shares of memory by how well they predict, not people by worth, but it is still a ranking, and [witness.md](witness.md) said not to build those. Worth keeping invisible.
- **Selection collapses.** The bred reading lists converged in five generations. Fitness drawn from many different people is the hope, not a result.

---

## The Numbers

The data: Synthetic-Persona-Chat (21,000 two-person chats written by a language model, very formulaic) and MiniPile (real web text, varied). The model: SmolLM2-135M-Instruct at 8 bits, as on the site. "First guess right" is how often the top guess is the next token. "Perplexity" is how surprised the model is by the real text; lower is better.

| | Formulaic chat | Real web text |
|---|---|---|
| The model alone, first guess right | 47.0% | 39.8% |
| The memory alone, at 0.07M / 0.66M / 6.5M tokens | 50% / 59% / 63% | 20% / 22% / 26% |
| Model and memory mixed, first guess right | 65.7% | 41.3% |
| Perplexity, alone and mixed | 8.9 to 4.5 | 23.5 to 21.3 |
| Perplexity gain, at each tenfold of memory | grows each time | 1%, 3%, 9% |

Infini-gram, a memory of 1.4 trillion tokens, reports 47% on human text from memory alone; a swarm sits somewhere on that curve.

Cost: 65,000 tokens index in 33 ms and take 0.4 MB; 6.5 million take 9 s and 39 MB; a lookup takes about 30 µs. As built, in characters: 2 million characters index in about 3.3 s, and a lookup takes 0.04 ms.

Liars, against 150 honest peers: with none, 61.6% right; with 15 pushing spam, 0% under plain counting or median rank, and 61.6% under trust by prediction. Fifteen sneaky liars (spamming 2% of the time) spoiled 28% of positions, 3.9% with one vote each and long matches confirmed by two trusted peers. Spammers working together got through every time they tried (1.8% of positions).

---

## Sources

- Infini-gram (Liu et al., COLM 2024): arxiv.org/abs/2401.17377
- Electric Sheep (Draves, 1999): en.wikipedia.org/wiki/Electric_Sheep
- Authenticated key-value stores (fingerprint trees over sorted data prove both presence and absence): arxiv.org/pdf/1904.12068
- Neighbors, for contrast: Petals and Pooled (neural network layers split across peers), De-DSI (decentralized retrieval, arxiv.org/abs/2404.12237), ZKPROV (zero-knowledge dataset provenance, arxiv.org/abs/2506.20915).
- From memory, unchecked: kNN-LM (2020), RETRO (2022), cache language models (1990), Prediction by Partial Matching (1984), Semaphore, and the literature on median-based aggregation (coordinate-wise and geometric medians in robust distributed learning, median rank aggregation, majority judgment).
