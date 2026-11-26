# Private Memory

*On asking a crowd for help without telling it what you asked.*

> Status: built and tested on this machine, in Chrome and Firefox, but not yet deployed. A work in progress.

---

## The Librarian

Imagine a library run by strangers. You want a book, but you would rather the librarian never knew which one. Maybe it is about an illness. Maybe it is a letter you are drafting. Maybe it is nobody's business.

The obvious options are poor. You could ask anyway, and trust the librarian. You could send a friend to ask for you, but then the librarian still learns which book was wanted, just not by whom, and your friend learns it too. You could check out every book in the building, so nobody can tell which one you meant, but the library grows every day, and so would your pile.

There is a fourth option, and it sounds like a magic trick. You hand the librarian a sealed slip of paper. To the librarian it looks like random scribbles. They do not open it, and could not read it if they did. Instead, they follow a fixed routine: they run the slip past every book on the shelves, every single one, the same way each time. Out comes another sealed slip, which they hand back to you. You open it with a key only you hold, and inside is the book you wanted.

The librarian did the same work for every book, so their work says nothing about which book you meant. The slip they saw was noise to them. The slip they returned was noise to them. You walked out with exactly what you asked for, and they learned nothing but that someone asked.

That trick is real. It is called *private information retrieval*, and it is how the extension's ghost text asks the swarm for help.

---

## Why It Matters Here

The Source writes ahead of you. As you type, a small language model on your own device guesses how your sentence goes on, and shows the guess as faded text after your cursor. Press Tab, and the guess is yours.

The model alone is a decent guesser. It gets much better with a memory: the swarm of other people's browsers, and a few servers, each remembering text they have seen (the chat, and the writing of chosen projects). Ask them "has anyone seen a sentence that ends like mine, and what came next?", and the ghost can finish a line the way people actually finished it.

In the site's own chat, asking openly is fine. Chat is public, and nobody expects privacy there.

The browser extension is different. It writes ghost text in *any* text field, on any website: an email to your doctor, a message to a friend, a form with your address. Asking strangers "what comes after *I have been diagnosed with*" tells them what you are typing. That would be unacceptable, even if every stranger were kind.

So the question has to be asked the way you would ask that librarian: sealed.

One rule comes before all of that. A sealed slip protects *asking*, and nothing else. Whatever an answerer remembers, anyone may ask for; that is the point of a memory. So what you type on other sites is never added to anyone's memory, not even your own browser's. The memory holds only what was public already: the chat, and the projects the library servers read. Your drafts only ever ask.

---

## The Easy Answers, and Why They Fail

Before settling on sealed slips, we looked hard at the cheaper ideas. Each one fails for a reason worth knowing.

**Hide who is asking.** Pass the question through several other people first, so the one who answers cannot tell where it came from. This protects the asker's name, not the question, and here the question *is* the secret. Worse, a draft usually names its own author ("Hi Dr. Patel, my son Liam..."), and each question overlaps the one before it almost entirely: you type a word, and the window of text slides along by a word. Anyone who sees a few questions can stitch them back into the whole draft, whatever roads they took. Hiding the asker is still worth doing someday, on top, to hide your network address; it just cannot be the whole answer.

**Scramble the question.** Send a fingerprint of your text instead of the text, so the answerer can match it against fingerprints of their own without reading it. But to find a match, the answerer has to be able to make the same fingerprints, so they can also fingerprint guesses until one fits. Language is predictable, and the questions overlap. In a test, a listener recovered every test text exactly, a few letters at a time, from the fingerprints alone.

**Hide it in a crowd of fakes.** Send nine made-up questions with the real one. Random fakes give themselves away, and believable fakes are hard to make for every keystroke. And the moment you accept a suggestion, the next real question contains it, which marks the real stream.

**Blur it with noise.** Change some words before asking. Enough noise to hide anything also breaks the exact matches a memory needs, and every question spends a little more of your privacy, until there is none left.

**Filter out the sensitive parts.** Let a classifier decide what is safe to ask about. It would have to be perfect, because every miss is a permanent disclosure to strangers. And "sensitive" depends on things no filter can see: a medical question, a resignation letter, a product's secret name.

**Split the question between two answerers.** There are schemes where two answerers each get half of a question, and neither half means anything alone. They need two answerers holding identical copies of the same library, who never compare notes. Browsers in a swarm each hold different text, and anyone can run two of them.

**Copy the whole memory to everyone.** If you hold the library, you never have to ask. This one actually works, but every new line of chat would have to reach every browser, forever, and the cost grows with every user and every message. We ruled it out.

What remained was the sealed slip.

---

## How the Sealed Slip Works

The mathematics behind the trick is a puzzle called *learning with errors*. It is the same family of puzzles behind the new encryption standards, the ones meant to stand up to quantum computers.

The idea fits in a paragraph. Take a secret list of numbers. Use it to make many sums that look random: each sum mixes the secret with public random numbers, and then a small random error is added. Given only the sums, finding the secret, or even telling the sums apart from pure noise, is believed to be hopelessly hard. With the secret, removing its effect is easy, and the small errors round away.

The sealed question is built from such sums. Hidden underneath the noise is a single marker saying which shelf you want. The answerer cannot see the marker, but their routine (multiply every shelf by the slip, and add it all up) carries the marker through untouched, because it uses nothing but adding and multiplying, and the hidden marker survives both. What comes back is your shelf, still under the noise, and only your secret can strip the noise away.

Stripping it away needs one more thing from each answerer: a *hint*, a summary of their shelves mixed with the same public random numbers. You download it once when you first meet them, and keep it up to date as their shelves change. It reveals nothing about you, because nobody's secret is in it.

Two things make this practical. First, a fresh secret is drawn for every question and never used again, so no two questions can be compared to give anything away. Second, the routine is plain arithmetic on whole numbers, which ordinary JavaScript does quickly. No special hardware, nothing to install, no compiled code.

There are cleverer versions of the trick, invented in the last few years, that shrink the hint or do away with it. For a library as small as a browser's, every one of them costs more: from a tenth of a second to most of a second per question, or extra keys of up to several megabytes. The plainest version (SimplePIR, published in 2023) is the cheapest at this size, and simple enough to write by hand.

---

## Turning a Memory into Shelves

There was a catch. The memory was built to be searched step by step: look up the last letter of your sentence, narrow it down by the letter before, and so on, until the longest match is found. Each step depends on the answer to the last, so asking each step privately would take dozens of round trips, and the shape of the search would leak.

So the memory is rearranged into a fixed set of shelves, laid out the same way everywhere.

Every word anyone wrote is filed on a shelf chosen by the twelve characters that came before it. On that shelf goes a small card: *after these characters, someone wrote this*, with the next few words. Each card also carries short fingerprints of the longer stretch before it (24, 48 and 64 characters), so a card that merely shares the last twelve characters can be told apart from one that shares a whole sentence.

When you type, your browser works out which shelf the twelve characters before your current word point to, fetches that one shelf privately, and reads the cards itself. It keeps the cards whose fingerprints match the most of what you typed, and whose words start with the letters you have typed so far. The answerer never learns which shelf; your browser does the matching in private.

Because every shelf has the same width everywhere, one sealed question works for every answerer, large or small. A shelf holds six cards. When it fills, the cards repeated most often stay, then the newest.

---

## Making It Feel Instant

A sealed question is much larger than an open one: about 64 kilobytes, where an open question was a hundred bytes. Even to a peer on the same machine, sending that much takes about a sixth of a second, and over the internet longer.

That would be too slow if the ghost waited for it. It does not. The shelf depends only on the characters *before* the word you are typing, and those do not change while you type the word. So the moment you start a word, your browser sends the question for it, and by the time you pause, the answer is usually back. Every guess within that word reads from the same fetched shelf, at once. Sealing a question takes about a tenth of a second too, so your browser seals a few ahead of time, while you are idle.

When the answer is late anyway (you paused the instant you began the word), the first guess goes ahead without it. When the answer arrives and clearly disagrees with what the guess wrote, the guess rewrites itself once, from the start, with the memory's help. The ghost never waits for the swarm, but the swarm can still correct it.

---

## Nobody in Charge

A memory that only a few servers could answer would be a memory a few servers could take away. So every participant can answer. Every open tab of the site answers from the chat it has seen; so does every copy of the extension; and the project's library servers answer from their larger collections of text. If the servers go down, the browsers carry on.

Answering is light work for a browser. Building its shelves takes several seconds, in the background, so the page never waits. After that, a new line of chat changes only the few shelves its words land on, within a quarter of a second of being said, and askers receive only what changed, not a whole new hint. Answering a question takes a few milliseconds. Each browser also gives out only so much (six hints a minute and twenty answers a second, across everyone it serves), so serving never drags a visitor's computer down.

If anyone can answer, a fair worry follows: a stranger cannot read your question, but could they plant a bad suggestion? They could try. Two safeguards limit the damage. Answers from the project's own servers, when they can prove who they are with a key, count for more than strangers'. And suggestions containing numbers, links or email addresses are shown only when two separate answerers agree on them, so a lone bad actor cannot slip a fake account number into a form you are filling in. A suggestion is still only a suggestion: nothing goes into your text until you press Tab.

---

## What It Does Not Hide

A sealed question hides *what* you asked. It does not hide *that* you asked, or *when*. An answerer sees a question arrive as each word begins, which reveals the rhythm of your typing. And over a direct connection, it sees your network address, as any peer-to-peer connection does.

Both could be hidden too: the first by asking on a steady clock, whether you type or not, and the second by passing questions through someone else. Both cost bandwidth, and neither is built yet.

---

## Where It Stands

The whole path works on this machine. A page in Chrome or Firefox, a tab of the site or a library server holding text, the extension asking, and the ghost following the answer: typing the start of a line the library held, the ghost went on with the library's own words, where the model alone wrote something else. A suggestion with a number in it was held back, since only one answerer offered it.

It also works with no server at all. With the library server switched off, the extension learned a site tab's shelves 21 seconds after the tab opened, and a line then said in that tab reached the extension's ghost 9.6 seconds later.

The shelves cost a little accuracy. When someone types text the memory holds, the memory's first suggestion is the word that actually came next about nine times in ten, where the old open search got it every time. The misses are shelves too full to keep every card; roomier shelves close most of the gap. On text the memory has never seen, the old search found more short, weak matches, and those count for little in the ghost anyway.

Not done yet:

- **Deploying the servers' part.** Their image needs rebuilding. Each server makes its own key the first time it starts; listing those keys when building the extension lets it count the project's servers above strangers. Browsers answer without any of it.
- **Checking the safety margins.** The size of the puzzle (how many secret numbers, how much error) follows a published choice made to withstand the best known attacks. It should be confirmed with the standard tool for that before anything sensitive relies on it, along with whether the shared public numbers should be renewed from time to time.
- **Remembering hints between sessions.** Each new browser session downloads each answerer's hint again.
- **A switch.** There is no way yet to turn the memory off while keeping the ghost.
- **A phone**, asking and answering, with the model running beside it.

Open questions:

- **Timing.** Is the rhythm of word starts worth hiding, at the cost of a steady trickle of questions?
- **Upload.** Each word sends its 64 kilobyte question to each answerer it asks, up to four: a quarter of a megabyte per word. Narrower shelves would mean smaller questions, but larger hints.
- **Short matches.** A second shelf, keyed through the letters you have typed, would catch more of them, at twice the questions.
- **Bad suggestions without numbers.** The two-answerer rule stops planted numbers and links, not planted words, and two strangers working together could pass it.
- **Mozilla's rules.** Whether sealed questions about what you type count as "collecting" it, in the sense Firefox's add-on store asks about.

---

## The Numbers

Measured on the user's 8-core desktop, one thread:

| | A browser | A library server |
|---|---|---|
| Text it answers from | about 450,000 characters | about 1.8 million |
| Its shelves, in memory | 4 MB | 16 MB |
| Building them from scratch | 7-9 seconds | 30 seconds |
| A new line of chat | 7-34 ms, and 5-38 KB to each asker | |
| Its hint, downloaded once | 1.3 MB | 5.1 MB |
| Answering one question | 6 ms | 25 ms |
| A question up / its answer down | 64 KB / 1 KB | 64 KB / 3.6 KB |

On the asker's side, sealing a question takes 130 ms (done ahead of time), and opening an answer under a millisecond.

How often the memory's first suggestion was the word that actually came next, on web pages from FineWeb:

| | Text the memory holds | Text it never saw |
|---|---|---|
| The old open search | 100% | 12-19% |
| Shelves | 89% | 2.5% |
| Shelves holding half as much | 95.5% | |
| Shelves holding a quarter as much | 97.3% | |

---

## Where It Lives

For anyone reading the code:

- `src/js/pir.js`: the sealed question and its answer. The puzzle's size: 1,408 secret numbers, errors of about 6.4 either way, and arithmetic modulo 2^32, following HintlessPIR's update of SimplePIR's choice for 128-bit security.
- `src/js/contexts.js`: the shelves and their cards.
- `src/js/private.js`: how askers and answerers find each other, talk, and keep hints current.
- `src/js/answering.js` and `src/js/answer.worker.js`: browsers answering, in the background.
- `containers/node/peers.js`: the library servers answering.
- `extension/host.js` and `extension/page.js`: the extension asking, as you type.
