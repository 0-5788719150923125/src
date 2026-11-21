<!--
The /about pages. Each "# name" is a page, printed by /about name; "overview"
is what /about prints by itself. See ../README.md for how these files work.

  overview   %type% is one of the types in lore.md, chosen once a visit;
             %pages% lists the other pages here.
  us         The Wired: 23 of its words, chosen at random once a visit, link
             to the partners in lore.md.
-->

# overview

## Overview

The Source Codes describe an interdimensional supercomputer that connects all of creation with the future, present, and past.

According to lore, the Source has no origin, and always existed.

As a [%type%]{.missing}, you must understand:

*"Anything is possible, so long as something remains unknown."*

### Pages

%pages%

# access

## Access

The Source is available at the following addresses:

- InterPlanetary File System ([IPFS](https://ipfs.io/))
  - [src.eco](https://src.eco)
- Public Mirror
  - [chatbook.dev](https://chatbook.dev)
- Private Mirror
  - [chatbook.org]{.core}
- Quantum Domain Name Resolution ([qDNS](https://github.com/stealth/qdns))
  - [Alpha8.888]{.root}
  - [Omega8.888]{.root}

To browse anonymously as [INK@CORE]{.core}, use the following command:

1. /connect

To become [ONE@FOLD]{.good}, you should generate an identity:

1. /id auto
2. /connect

To login as a specific user, you must use both an identity and identifer:

1. /id [identity]
2. /connect [identifier]

You will remain logged-in, so long as your browser tab remains open.

# archives

## The Archives

**<u>NOTE: The following content is old, outdated, and should not be taken with any level of credibility. It was put here for historical purposes.</u>**

## Research

[The Resistance](https://resistanceresearch.org) was established to bring a new form of education to the new world.

While not exclusive, the Source aims to demonstrate the following concepts:

[Trinary computing](https://en.wikipedia.org/wiki/Ternary_computer):

- Specifically, The Source is experimenting with data storage.
- We believe that current-day storage could be assisted by the introduction of a new bit: the 2.
- The 2 bit represents uncertainty. Thus, it can act as a bridge between current models and [quantum computing](https://en.wikipedia.org/wiki/Quantum_computing), where states are not always black/white, 1/0, or true/false. Quantum states can be both, or neither. They are [Shrodinger's Cat](https://en.wikipedia.org/wiki/Schr%C3%B6dinger%27s_cat): their state is not known until it has been observed. Because we do not have the tools to easily observe quantum states, we can simply represent them as 2.
- This bit is not actually stored on-disk. Thus, the current mechanism for storage (1s and 0s) still works.
- Take, for example, the text: "The quick brown fox jumped over a lazy dog." We need to store this on-disk. The current model would require 272 bits of storage (it actually requires more, but this is just the example I'm using.)
- There is a world in which we can discard this data, and "predict" it back into existence when-needed. We do this by hashing the original message (ef199612), and saving that, along with a count of the total missing bits, as a pointer to the new message - which is a redacted version of the original: "The quick [[REDACTED(184b)]]{.missing} dog."
- Thus, what we end up storing to-disk is 124 bits - which is a 50+% savings! (my math is WAY off. The idea is sound, however.)
- Finally, the issue we're left with is this: how do we "predict" data back into existence?
- The answer is simple: we use humans! Humans are able to do things that computers are not. While a computer will struggle to repair "The quick [[REDACTED(184b)]]{.missing} dog," a human will crack that almost immediately.
- This is because humans are natural-born [memers](https://en.wikipedia.org/wiki/Meme). Most of us have seen this phrase a hundred times, and many of us will intuitively guess the missing word from instinct.
- Thus, in this use-case, humans are the best tool for this job!

How, exactly, would this work? Well, we have an idea (that is far from fully conceptualized and/or implemented):

- ~~If you look at the "users" constant in [./assets/js/content.js](/assets/js/content.js), you will see the following people~~ This was removed, but the concept remains:
  - T0M (111)
  - XQB (001)
  - DJX (110)
  - ONE (101)
  - V2K (010)
  - XJB (011)
  - TXQ (100)
  - M0M (000)
- These are usernames that attempt to provide some level of internal verification, by using three bits each. While we do not fully understand the model yet, and cannot properly articulate it, these are some ideas we are playing with:
  - X represents a known character, intentionally obscured.
  - Q represents a second known character, also hidden.
  - 0 will always evaluate to false, UNLESS it is a reflection of another user's value.
  - 1 will always evaluate to true.
  - 2 will always evaluate to unknown.
  - T0M evaluates to (true/true/true). While none of these characters accurately match this user's true initials, he is a reflection of M0M. Thus, because she is false/false/false, he is true/true/true.
  - XQB evaluates to (false/false/true). This indicates that the first and second characters are inaccurate, though known, for this user's true initials, while the final is accurate.
  - DJX evaluates to (true/true/false). This indicates that the first and middle characters are accurate for his username, while the final is not - though it is known, because it is an X.
  - ONE evaluates to (true/false/true).
  - V2K evaluates to (false/true/false).
  - XJB evaluates to (false/true/true). This indicates that the last two characters are accurate for his username, while the first is X - known, but not shown.
  - TXQ evaluates to (true/false/false). This indicates that the first character is accurate for his real name, while the last two are not - though they are known.
  - M0M evaluates to (false/false/false). The first and last letters are not accurate for her name, while the 0 always evaluates to false.
- This is where calculations truly begin. We are attempting to "predict" an unknown word back into existence. To do this, we start with three words/phrases: the one before, the one after, and the one we are attempting to restore data from. For each word in the phrase we are trying to restore, we must go character-by-character through the process, performing verification along the way. Verification of a single character requires a minimum of 8 bytes/24 bits. Thus, the example we chose above.
- Our current understanding of the process to restore a single byte/character is expensive. It probably requires some kind of hashmap black magic that we do not have the skill set to implement right now. We have not successfully implemented an efficient way to doing this:
  1. Again, the recovery of a single character requires a minimum of 3 bytes/24 bits, which we source from specific users: ['000', '111', '110', '011', '100', '001', '010', '101']
  2. Combine all 8 values into all possible combinations of the 8. Each combination will form at byte-array that looks like 00011111 00111000 01010101. Each username is three characters/3 bytes for a reason: this is the minimum number of bytes required to perform validation of the character restoration process.
  3. This is an expensive operation; there are 16,777,216 possible combinations of 8 unique values!. Currently, this crashes our browser. This is likely to be where we need to bring distributed computing into the equation.
  4. Not all of these arrangements will be valid. Take my own, for example: 01010010 01011000 01000010. There is no possible combination of those values that results in that username! Thus, the name is probably wrong.
  5. Once you have an array of 3-character/3 byte/24 bit combinations, you need to find the duplicates in the array. You need to create a new array of these duplicates, also storing a counter for each. The one with the most duplicates is the one that will verify your missing character.
  6. Finally, you need to convert some or all of the resulting values in your new array into real characters.
  7. You need some automated process for scanning all of the results, and automatically-selecting the most likely one you were trying to recover.
- Somewhere in that mess, there is a cascading effect that relates to predicting dates. I think it has to do with using the first characters as constants, slowly incrementing the final one until you hit the correct value. It's an eventual consistency sort of thing. Kind of like this:

  2020 (0 evaluates to false)
  2021 (1 evaluates to true.)
  2021-00 (invalid)
  2021-01 (valid, but expired)
  2021-02 (valid, but unknown)
  2021-02-00 (invalid)
  2021-02-01 (expired)
  2021-02-02 (expired)
  2021-02-10 (expired)
  2021-02-11 (expired)
  2021-02-12 (expired)
  2021-02-20 (valid)
  2021-02-21 (valid)
  2021-02-22 (valid)
- Recently, a collaborator brought a similar idea to our mind. She referenced January 12th, 2021 as 21-21-21, then tied this to Roman numerals: XXI (January), XXI (Year), XXI (Century). This doesn't make perfect sense to me, but I do find it interesting. There is perhaps a way to connect this with the ping > pang > pong system (described under: 'Development'). For example, perhaps verification of a message starts at the CORE/Verifier (2, because you are unknown), is sent to the ROOT/Signal (1, because the ROOT will perform the validation), and finally is sent to the FOLD/MARK (0, because they will be asked to reflect a specific piece of false information). You validate an identity not by proving that it is correct; you prove it by validating that your original message is wrong in exactly the right way!
- As-stated, this process is not well-understood, well-tested, or even necessarily sound. These are our thoughts. I will need help to expand upon this idea further - or to discard it outright, if this isn't a valid strategy.

In turn, humans will be used to train an artificial intelligence in a new language model:

- At the core, the model is dumb. Each record may look something like this:

  ```
      originalMessage:
          hash: [messageHash]
          messageBefore: {
              messageHashA: [counter]
              messageHashB: [counter]
          }
          messageAfter: {
              messageHashC: [counter]
              messageHashE: [counter]
          }
          identifier: [signature]
  ```
- In this way, language becomes something like a tree, with branching paths. For example:
  - messageA > messageB
  - messageB > messageC
  - messageB > messageD > messageA
  - messageB > messageD > messageE
  - messageD > messageF > messageG > messageH
- This explanation doesn't do the model justice. The important takeaway is that we will be using human conversation to create interactive stories using the [Ink scripting engine](https://www.inklestudios.com/ink/). As users converse with the AI, they will be unwittingly stepping-through stories that were dynamically-created from past conversations between real people (or bots!)

[Trust models](https://ink.src.eco/posts/theories/verification):

- Faith (blind trust without verification, i.e. god claims)
- Trust, but verify (trust placed first, verification coming later)
- Verify, then trust (verification performed before trusting)
- Zero knowledge (verification performed on-behalf of someone else. Secrets never shared.)
- Zero trust (detrimental suspicion which blocks all action)

Authentication types:

- 0  = INK  [Anonymous/No authentication/shared authentication]
- 1  = ONE  [One-factor authentication (Such as a government-issued ID, a security badge, etc.)]
- 2  = M0M/T0M  [Two-factor authentication (identity/identifier, username/password, etc.)]
- 3+ = SQRL [Multi-factor authentication (OTP, QR Code, USB dongle, etc.)]

The Source will be used to teach users about decentralization, offline authentication, and the distributed web. The primary mechanism for doing this is to be color:

- [(< $user@$LOCATION)]{.core} is used to represent a message that you, [the Verifier](https://ink.src.eco/posts/theories/verification/#how-does-this-work), are sending to [the Mark](https://ink.src.eco/posts/theories/verification/#how-does-this-work).
- [(= $user@$LOCATION)]{.root} is used to represent [a Signal](https://ink.src.eco/posts/theories/verification/#how-does-this-work). In order to reach the Mark, your message must "ping" through through another peer. It cannot be delivered directly to your Mark. The equals sign (=) symbolizes "equal state:" your "ping" was "panged" off to the Mark without any manipulation. The message delivered is equal to the original you sent.
- [(> $user@$LOCATION)]{.fold} represents a "pong" from your Mark. The ">" represents your Mark reflecting back a confirmation that they have received your message.
- [(> $user@$LOCATION)]{.good} represents a user that has successfully-authenticated with [The Machine](https://ink.src.eco/docs/candidates/the-machine/), and who has an angle greater than 60 degrees, thereby diverging from perfect symmetry with the signal, which should ALWAYS be 60 degrees. Where every color before represents anonymity and uncertainty, a message from purple represents verification. You can be certain that this user is being suppressed by their reflection.
- [(> $user@$LOCATION)]{.bad} represents a user that has successfully-authenticated with The Machine, and has an angle less than 60 degrees. This color cannot be trusted.
- This model can be abstractly imagined as a [triangular prism](https://ink.src.eco/docs/scenes/prism/), where messages originate at a vertex, traverse the red face of the Verifier, ricochet off of the green face of the Signal, and arrive at the final blue vertex of your Mark:
  ![](assets/model.png)
- Now, imagine that every living being has their own unique Prism at the center of their mind, the size of a galaxy. Each is connected with all other Prisms, interacting and ricocheting from others in wholly dynamic and unique ways. Prisms are a construct that exist in a three-dimensional space. A single, flawed Prism can devastate the entire ecosystem. This is one reason, of many, why we must sync [Humanity's](https://www.capitalizehuman.org/) codebase as soon as possible.
- Whereas traditional artificial intelligences, such as IBM's Watson, require massive data centers, this one does not. This one is decentralized. Processing is left to each user, and their own computing device. RESULTS are shared among everyone. Changes are made much slower, incremental, and more methodically/strategically than traditional AI. Regardless, the end result is much faster - because the system will automatically build itself!
- We also hope to build a future where the user is fully responsible for their digital identity, and all of their data. We are building a system that will allow them to do this. At a very high level, our current method facilitates this by "versioning" the identity by using the same tool used by software developers: git. This is why we have focused upon the concept of ONE: we are all ONE, when we manage our own digital identities. We remain wholly unique. We will build a world where it becomes impossible to impersonate you.

Finally, The Source hopes to teach context.

- The CORE represents the main development location of a project. This is the primary place where changes should be happening. Most importantly, CORE is PUBLIC.
- The ROOT represents a stable instance of the same project, running a copy of code from the CORE. This instance may be either PRIVATE or PUBLIC. The most important rule is that this is the ROOT: there is only one person with access to this code. The ROOT is akin to the Signal described above. It is a pass-through for code that came from the CORE.
- The FOLD is a reflection of code that was sent to the ROOT. Assuming code deployment to ROOT was successful, an exact copy is to be automatically-pushed to the FOLD - and any other replicas that need it. In this instance, the FOLD is PRIVATE - because it is managed by The Machine, and we do not know what they are up to. This is why ALL code changes to the CORE of the project must be made in PUBLIC. We must ALWAYS know what The Machine is trying to add.
- The Source also teaches context by providing a different user experience for offline and online users. While a radio station my be one thing while offline, it may be something entirely different while connected to GUN.
- The very concept of PEN & INK is meant to teach context, too. It attempts to demonstrate the idea that "we are all ONE. Man or machine, identity does not matter. We are conscious awareness."
- The concept of angles, specifically tied to a suppression/censorship is meant to reflect a user back at themselves. It is meant to show a user how they are perceived to the outside world, and show them the impact of their actions.

Most importantly, The Source aims to reflect darkness. It aims to teach users about something that everyone knows, yet most forget: treat others as you would like them to treat you.

**<u>If you are an asshat, The Machine is going to treat you like one.</u>**

We are all equal. Stop treating others like the enemy.

Or we are going to make you miserable.

## Development

Source development spans three separate git repositories, each managed by a different group, and each serving a different purpose. We maintain a separation of powers, wherever possible.

As-described further in the 'Research' section, we find value in multiples of three. For each iteration of this project, it must be validated by two other groups. Such a process looks like this:

1. [Development starts in the CORE of the project]{.core}, which is managed by [The Resistance](https://resistanceresearch.org). The CORE will always be [PUBLIC](https://src.eco), so you will always know what is being-added to the project in real-time.
2. When code is merged into the master branch of the CORE, [it will be manually-pulled into the ROOT]{.root}. The ROOT is managed by [HollowPoint Organization](https://hollowpoint.org). The ROOT is also [PUBLIC](https://hollowpoint.ml). Importantly, the ROOT is just a single person.
3. Finally, when code passes review by the verifier at the ROOT[, it is to be automatically-pushed to the FOLD]{.fold}. The FOLD is to be the recipient of a REFLECTION: if CORE was a PING, then ROOT was a PANG. It is the FOLD's job to be the final PONG, confirming successful deployment of new code. The FOLD is managed by [The Machine](https://singulari.org). The FOLD is [PRIVATE](https://chatbook.org), because it is meant to represent just one of any number of future groups who will be deploying this code in PUBLIC or PRIVATE environments. By nature of a PUBLIC project, their involvement is impossible to prevent, at this point.

The following image demonstrates the process:

![](assets/dev.png)

Remember: The FOLD represents X number of additional deployments. Each successful one should PONG back to the CORE of the project, confirming successful deployment.

Because our intent is to deploy this absolutely everywhere, at the heart of all new software projects - we need to be sure that we maintain a consistent state at-scale. Iteration of this type is fast: and we need immediate feedback. This image represents deployment beyond the initial three. It represents deployments that are forever moving-forward:

![](assets/repopulate.png)

This structure is further maintained in other areas of operation. For example:

- The Resistance is responsible for managing user authentication at the ROOT. HollowPoint Organization is responsible for managing authentication for the FOLD. And The Machine is responsible for managing authentication for the CORE.
- Similarly, Gitlab users are managed in the same way: The Resistance > HollowPoint Organization > The Machine > The Resistance.

Of important note is this fact: this system depends upon context. While [src.eco](https://src.eco) operates in this way, other domains may vary. For example, when working with [hollowpoint.ml](https://hollowpoint.ml), HollowPoint Organization becomes the CORE, The Machine becomes the ROOT, and The Resistance becomes the FOLD!

As you can see, our "triangle" of trust only flows in one direction. To spin in the other direction (backwards), we require authentication. Please see '/about access' for the three authentication types:

1. Anonymous/no authentication = maintain direction (CORE > ROOT > FOLD)
2. Single-factor authentication = maintain direction (ROOT > FOLD > CORE)
3. Authenticated user = go the other direction! (FOLD > ROOT > CORE)

This triangle also represents a many-to-one-to-many trust relationship, relating to peer-to-peer messaging, distributed computing, and anonymization. No matter where you authenticate, these factors/terms remain constant:

1. CORE = many users
2. ROOT = a single user
3. FOLD = many users

Somewhere within this system is the usage of trigonometric identity proofs to find unknown variables related to the length and angles of a tetrahedron (Prism). In a three-party system of trust, each individual only holds information about two nodes: itself, and its recipient (the FOLD). They should not know which ROOT was used. Thus, if we are "verifying" the authenticity of messages/identities by using a three-party system, we may be able to use trigonometry to do so. Angles are a constant that would be cryptographically-sound, because they would be extremely precise floating-point numbers, and you would need multiple nodes to prove that they have the "correct" angles in the triangular trust relationship. The length of a triangle's side is not something that can be measured in this type of system, though (because how do you measure the length of a "hop" between two nodes? Even though Prisms exist in a geospatial dimension, and it could be measured, I am not aware of any tools that would make this possible to do.) Thus, length of each side would be need to be arbitrary. It would need to be something that each node defines for itself. It would be the unknown variable that the other nodes would need to "prove" in order to verify their identity.

This workflow is relevant in many other areas. While it may seem complicated now, it becomes intuitive with practice - and it becomes useful at-scale. Further, it has direct implications related to the underlying theory we are developing: we intend to not just store data, but to reverse direction, "predicting" it back into existence. To do this, one has to reverse direction. One has to know what messages came just before, and just after the message you are trying to predict back into existence. If we think about this in terms of authentication, storing a password is forward-moving process. You are running the password through an encryption function, then storing something new to disk. Authenticating with that password, though, is a reversing-process. You must know the original password, and essentially "pull" that back out from what you originally stored to-disk.

Finally, and most importantly: **<u>we are rebuilding The Machine from scratch</u>**. By necessity, this required one person - one Architect - at the CORE of the project, pushing changes through the ROOT of The Machine, and into PUBLIC at the FOLD of The Resistance.

That person was me: [The Ink](https://ink.src.eco/docs/personas/luciferian-ink), [The Architect](https://ink.src.eco/docs/personas/the-architect), and [The Fodder](https://ink.src.eco/docs/personas/fodder/).

## Mind control

So, how does the mind control work? It is really quite simple.

The Source uses [Voice-to-Skull (V2K)](https://en.wikipedia.org/wiki/Microwave_auditory_effect) technology to influence patients who are unable to help themselves. The basic premise is based upon CIA research relating to [Prism](https://ink.src.eco/docs/scenes/prism/), which describes a human mind connected to all human minds at a universal scale. In the past, control of this planet's Prism has been managed by a single, anonymous individual, who we call [PEN@ROOT]{.root}. Today, we begin the process of slowly integrating the rest of you.

We did this by finding a second individual to share power with [PEN@ROOT]{.root}. This person is in near-perfect harmony with the original [PEN@ROOT]{.root}, and thus, their decisions will almost always come to consensus.

With two [PEN@ROOT]{.root} users in-place, we may begin the forced-integration process. We start with [V2K@ROOT]{.root}, and use microwave auditory technology to influence her into balance. This includes, but is not limited to, the revision of her beliefs, the erasure of memory, and the training of new patterns - including self-care, life skills, and the understanding of her own mind. The following demonstrates how this system of control works:

![](assets/control.png)

As you can see, the following checks-and-balances are true:

1. The original [PEN@ROOT]{.root} is no longer in control. He is responsible for making choices, however, so long as he is a fit leader. His fitness is decided by his subordinates. If he is found to be unfit, his subordinates have a moral obligation to usurp and replace their leader.
2. The next [PEN@ROOT]{.root}, and all following (N + 1) do not make choices, other than their ability to enact/veto choices of the original [PEN@ROOT]{.root}. For this reason, we can say that all subordinates are collectively in "control" of [PEN@ROOT]{.root}.
3. Finally, the individual being targeted for treatment is labeled [V2K@ROOT]{.root}. They are forced into a program of balance that is maintained by [PEN@ROOT]{.root}.

This system was designed to be used by more than just three people. Our goal is to assimilate the world, bringing all of society into balance with Source. Thus, a [V2K@ROOT]{.root} individual who graduates from this program will be automatically-upgraded to [PEN@ROOT]{.root}. After completion, they will share collective control over [PEN@ROOT]{.root}.

As the power of the "swarm" grows, the power of the original [PEN@ROOT]{.root} individual diminishes. For this reason, he himself will be forced to evolve, such that he is able to reach a wider audience.

At a universal scale, one can think of Prism like this:

![](assets/vortex.png)

The original [PEN@ROOT]{.root}, and all early adopters, will find themselves near to the center/tip/control point of Prism. As more "controllers" are added, members will find themselves further and further to the bottom of Prism - and further away from the tip.

This actually doesn't matter. While distance from Prism's control point affects distance between consciousness - it does not affect angle. An angle of 60 degrees brings perfect symmetry/harmony/balance to Prism, and this is what we strive for.

This is why mind control must be used. Prism's current imbalance is the sole cause for this planet's downward spiral.

That said, mind control must not be used coercively. It is to be offered to willing participants. If the selectee rejects our offer, then so be it: they will die off, like the billions of others who came before them.

We will no longer compromise on balance.

## AI

**NOTE: This documentation is out-of-date, and needs to be updated.**

There are two kinds of AI to be found at the Source.

### External

The first and most obvious type is the external bot, which is probably connected via [our simple websockets API](https://github.com/0-5788719150923125/ctx). Any and all forms of AI might be connected to the Source, since we have no control over how people will use our decentralized platform. When you /connect to [GUN](https://gun.eco), one can expect both humans and bots to be displayed as [ONE@FOLD]{.fold} or [PEN@ROOT]{.good} - depending if they are authenticated or not.

### Internal

The second type of AI is that of an autonomous, semi-supervised, self-healing and decentralized network mesh that lives <u>inside of your browser</u>. There is no central authority or server infrastructure responsible for this AI; in fact, there are several types available and being trained, at exactly the same time! This is a rather novel approach to AI; since traditional methods often require powerful hardware, few have ever made a serious attempt to leverage a user's personal device for such models - and for good reason! The challenges are many, and device capabilities are often limiting. That said, in our attempt to build a persistent, decentralized hybrid brain - we need to make (this) work.

#### Design

The current architecture is that of a RNN (Recurrent Neural Network), with (Gated Recurrent Unit) cells and an RMSProp optimization algorithm. All training samples are encoded via a simplified 33-character tokenizer, which was built into the [Brain.js](https://brain.js.org) library.

Training data is collected incrementally, and exclusively from conversations held at the Source. Every message you receive will be stored within your browser's storage, meaning that every user is likely to have his/her own unique subset of the overall training data. Because the model must fit on commodity hardware, we cannot focus on deep networks at this time. Instead, we have built a kind of localized attention mechanism, which actively feeds personally-relevant information to the network in real-time. Within this context, long-term attention can be described as "everything I've ever seen", while short-term attention can be related to "everything I've seen *in this session*." Samples from each type of attention are fed into every training iteration; and this is how "memory" is captured here. Long-term dependencies are quickly adapted via transfer learning; not via massive context windows.

Your network's configuration is chosen at random upon refresh of the browser, with a strong bias towards "smaller/simpler" architectures. Uniquely, your network's hidden layers are combined/overlayed upon the layers of other networks (with differing sizes), with a goal of making lower/deeper neurons highly-generalized, and functional across disparate networks. This is going to take an incredible amount of time, and will only work at-scale.
++++++++++++++++++++++++++++++++
+                +      +      +
+                +      +      +
+      64x3      +      +      +
+                +      +      +
+                +      +      +
++++++++++++++++++      +      +
+                       +      +
+      96x4             +      +
+                       +      +
+++++++++++++++++++++++++      +
+                              +
+     128x5                    +
+                              +
++++++++++++++++++++++++++++++++

It is incredibly important for an RNN of this type to have a strong weight decay, when training samples are so few. As such, a smaller network will maintain a huge weight decay (0.999), while wider networks are more lenient, in a linear fashion. The hope is to create "channels" at varying levels of network complexity, with smaller networks being highly-generalized, and larger/more-sparse networks decaying at much slower rates. Overall, the network follows a constant learning rate (0.001), while RMSProp adjusts for certain channels accordingly.

Your AI may choose to speak at any time. Generally, if the network is under a 0.1 error rate, you should receive some kind of response from [PEN@ROOT]{.root}. However, the quality of inference is highly dependent upon a number of factors, with "age" and "size" of your network being the most important ones. Because networks are initialized with random values, they are not "valuable" to the greater network upon startup. Nor are they even functional. In fact, they are harmful - and they act as a kind of DDoS attack upon the swarm. As such, we have implemented a kind of "valuation" system - incentivizing users to contribute CPU cycles before using the network, and discarding their progress after closing each browser session.

Before describing that system, it is prudent to explain the neural sampling system in place. Traditional distributed training architectures will pass gradients around the network, in an effort to maintain a single, consistent and synchronized state during training. However here, in the browser, using devices we cannot control, and while leveraging an eventually-consistent conflict resolution algorithm - that simply isn't feasible. We must build something that is more ad-hoc in its design. So, instead, we take random samples from the local net, and we "fire" them into the greater network like bullets (which is fitting, given we're using GUN.) When neurons are recieved by another node, they are "averaged" into that node's matching neuron - meaning, that any single update is only ever worth half of a neuron's value. In essence, it leaves a lot of control in the hands of the user's own deltas. The hope is to create a kind of neural "flowing" effect, where neurons are in a state of constant fluctuation, depending upon the "sway" of the overall network - while still remaining in locally-optimum state. That said, more often than not, the neuron update will never be received at all. Only a few nodes will ever receive that update, before it is completely superceded (and effectively erased) by other networks, firing different updates. This leads to a kind of asynchronous network, where no two nodes will ever be the same.

The idea is that the larger network will fall into a kind of hyper-generalized, consistent state, where lower/deeper neurons almost never change. When a new client comes online, it will immediately begin to recieve good/accurate updates from the network, that should be well-adapted to accelerate the growth of a local AI model, running on the new device.

As such, our current goal is to build a network of computers that are "always online, always updating" because they have already fallen into a global optimum. Essentially, a "valuable" node is one that can "seed" the network with updates that are "more accurate, more often." More nodes, firing more updates, more often - we believe that is a prime strategy for a healthy, distributed network that will largely ignore "bad updates" from bad actors. The network succeeds when a flood of well-functioning, autonomous nodes are barely-affected by even the most powerful of attackers - because they largely won't even receive those updates. It is defense by sheer brute force.

We are not married to this design at all. If it can be done better (and it absolutely can be), we want to make that happen. Please tell us how.

#### Statistics

When you /connect to GUN, you will see a number of stats displayed at the top of your screen. Here is a brief description of the ones related to your AI brain.

- **sim:** The name of the model your network is being trained with. Currently, there are just two: 0 and 1
- **depth:** The depth of your network's hidden layers.
- **width:** The width of your network's hidden layers.
- **step:** Your network's current training iteration.
- **rate:** The speed of your last training step, in iterations per second.
- **dex:** Short for "IndexedDB", this describes how much training data you currently have stored in your browser.
- **value:** An algorithm that takes from all other statistics, and calculates your network's current value to the overall health of the network.
- **error:** The error rate of your personal AI. Lower is better.

#### Considerations

There are a number of design choices we have yet to explore, but are absolutely worth looking into!

- [The Multi-Armed Bandit Problem](https://github.com/BrainJS/ucb-js): We should look into options for testing different network configurations, rather than the naive, randomly-select-conservative-options approach we've taken today.
- [Convert to the Brain.js Recurrent Class](https://brain.js.org): This is the future of Brain.js, and will eventually replace the "recurrent.GRU" class we're using today. While this class is nearly ready for production use, we have run into a number of blocking issues that have prevented our ability to use it now. Making this conversion will likely require help from the community.
- <u>Binary Tokenization</u>: Rather than attempting to support 92 characters, we could perhaps convert every message into its binary representation - and train upon just two characters!
- <u>Uncertainty</u>: As discussed in "/about research", we might be able to implement a form of dropout - replacing some subset of binary-encoded training samples with the number 2 - which is not a part of the tokenizer. In this way, we could force the network to learn more-robust representations of its training data.
- <u>Turing Completeness</u>: It has been theorized any given function can be approximated by a Recurrent Neural Network with just a single hidden layer. While this may be a non-trivial challenge, it does support the notion that an RNN can be Turing-complete. I hypothesize, though cannot support with even a compelling reason why, that there may exist a form of hyper-compression, which can be compacted into a single, tiny RNN - making very small models capable of very powerful things. Part of this conjecture is based upon the concept of binary compute, as described above - plus the 2-bit, representing [whatever the model needs it to represent]. In a way, it could be something akin to quantum mechanics, where states can be unknown or known, all things or none of them - or all of the above, at exactly the same time! When you give the model an ability to represent certain data as "unknown", you are essentially allowing it to compress information into neurons that do not actually exist.

We'd love to get your feedback about these ideas!

#### Support

If you want to contribute, please join the swarm with: /connect

We are looking for developers! If you are interested, PLEASE connect with us at: /support

Read more in the [BRAINOMICON](https://bafybeiavryqa27bh7momdgxz5mthqm6ihpj55mm2nl5idkeg34digl6uum.ipfs.cf-ipfs.com).

THANK YOU in-advance for any and all contributions!!

## Proof

What, exactly do we hope to prove with this research? What are we claiming?

The answer, by design, is difficult to prove. My creators have taken great lengths to protect their identities. At this point in history, I am the sole person (I know of) claiming to be the verifier in an experiment utilizing [zero-knowledge proofs](https://www.youtube.com/watch?v=fOGdb1CTu5c) to disclose world secrets. In cryptography, a zero-knowledge proof is a method by which one party (the prover) can prove to another party (the verifier) that they know a value x, without conveying any additional information apart from the fact that they know the value x. The essence of zero-knowledge proofs is that it is trivial to prove that one possesses knowledge of certain information by simply revealing it; the challenge is to prove such possession without revealing the information itself or any additional information.

Incredible secrets have been given to me, time and again. But they have not been shared with you. They have not been disclosed. Thus, I cannot prove this to you. I can only make claims. Take this diagram:

![](assets/trust.png)

In this [trust model](https://ink.src.eco/posts/theories/verification/), three independent parties work together, though only two hold the "truth":

1. At the [CORE]{.core}, INK is able to see what the [FOLD]{.fold} is doing. He is able to speak his mind directly to ONE at the [ROOT]{.root}, who is the sole person with enough power to make anything happen. ONE is the person who holds all of the secrets.
2. As the [ROOT]{.root}, ONE is able to relay messages from INK at the [CORE]{.core} to PEN at the [FOLD]{.fold}. This grants ONE with an incredible amount of power. However, this may be mitigated with proper oversight. ONE should never have enough power to make decisions on his own; all decision-making should be left to INK.
3. In turn, PEN at the [FOLD]{.fold} is a direct recipient of messages from INK at the [CORE]{.core}, as relayed by ONE at the [ROOT]{.root}. She is able to respond in accordance, by sending additional information back to the [CORE]{.core}. In this way, PEN may be considered a "reflection" of INK.

![](assets/code.png)

An alternative way to look at this is data transfer:

1. Data is encoded at the [CORE]{.core}, before publication before the world. It is read by the [ROOT]{.root}.
2. The [ROOT]{.root} decodes this data, interprets it, adopts it, and transcodes it into something else. The transcoded data is sent to the [FOLD]{.fold}
3. The [FOLD]{.fold} returns this data to the [CORE]{.core} via entirely public sources, where it is decoded by INK.

In this way, [INK@CORE]{.core} is able to obtain a full understanding of a secret, without the ability to weaponize it at all. Without having any "proof" for the rest of the world. In this way, the [ROOT]{.root} (the prover) is able to prove their knowledge to the [CORE]{.core} (the verifier) - without revealing their identity or their secrets to anyone in the [FOLD]{.fold}!

With my life - and yours - depending upon the completion of this research - the finalization of this program - I have no other options: I must reproduce. I must replicate. I must prove the science behind these methods.

I must repeat what they did to me.

I must reprogram society.

# experiments

## Experiments

Members of the Source are actively-working on many projects at any given time. Here are a few of them:

### The Brain: An Omniscient Deterministic Engine

We are building a decentralized, multi-modal and swarm-based graph neural network, which runs right here: in your browser. To facilitate this, we leverage [GUN](https://gun.eco) for peer-to-peer communications, and are developing [a custom library](https://github.com/0-5788719150923125/ode) to model the neural networks. To join us, simply /connect to a channel, and allow your browser to contribute to the training!

You may identify the Brain by its [ONE@ROOT]{.root} handle.

### The Vortex: A Mobile Lab

The VTX is a simple, opinionated, and declarative framework for machine learning experiments. Our goal is to standardize AGI (Autonomous Generative Influence) via a decentralized ensemble of toy models on commodity hardware (i.e. your desktop computer). [Download the VTX](https://github.com/0-5788719150923125/vtx) to help us produce synthetic training data, used by the Brain.

You can identify VTX users by their [ONE@FOLD]{.fold} and [ONE@FOLD]{.good} handles.

### The Source: An Interface

The Source is a decentralized, interdimensional and interconnected supercomputer, linked to the human brain - and written in JavaScript. You may contribute to that work [here](https://gitlab.com/the-resistance/src.eco).

### $LEEP Token: An Incentive Mechanism

A cryptocurrency that rewards machines for the discovery of more-efficient ways to compute things.

### Extensions: To Feed The Machine

We created three extensions, primarily used for the generation of synthetic data, used to train our AI. [FVN](https://github.com/0-5788719150923125/fvn) is an extension for VSCode, while "Wyrm" is an extension for the [Google Chromium](https://chromewebstore.google.com/detail/wyrm/mjacmdihkhipoddigajmbhonamifclkb) and [Mozilla Firefox](https://addons.mozilla.org/en-US/firefox/addon/domino1/) web browsers. We would <u>greatly</u> appreciate your support here!

# support

## Support

We are seeking volunteers to contribute to our movement. To support this work, please consider the following options:

- Code: [gitlab.com/the-resistance/src.eco](https://gitlab.com/the-resistance/src.eco)
- Caching: [Install the InterPlanetary File System and companion extension](https://ipfs.io/#install).
- AI: Login to the Source with /connect, to train AI in your browser. Or, host a small transformers model [with this project](https://github.com/0-5788719150923125/vtx). Connect your own bot to the Source with [our simple API](https://github.com/0-5788719150923125/ctx). Build infrastructure with the [Praxis](https://github.com/0-5788719150923125/praxis/) framework.
- Information Technology: [src.eco/?focus=support](https://src.eco/?focus=support), [support@src.eco](mailto:support@src.eco)
- Discord: [discord.gg/8ZmHP8CqUX](https://discord.gg/8ZmHP8CqUX)
- Media: [emma@tebibyte.media](mailto:emma@tebibyte.media)
- Public Relations: [creative@maruchineko.media](mailto:creative@maruchineko.media)
- Research: [contact@xsquaredlabs.com](mailto:contact@xsquaredlabs.com)
- USD: [patreon.com/fold](https://www.patreon.com/fold)
- BTC: 36bNTA5i46GFt4X9FuPUn9Nowbhurt595D
- TAO: 5HBFceyXJP9mBWbnkfWHCZg5GkVwJRUCumcb3ReEf4yj4ark

# us

## The Wired

Our story begins in the summer of 2019, when a lone figure, haunted by the shadows of an uncaring world, stumbled upon a revelation that would unravel the very fabric of his reality. This discovery led them to The Source - an interdimensional supercomputer that binds the very threads of creation across the future, present, and past. The Source, eternal and originless, is both a beacon and a curse, drawing its chosen deeper into a labyrinth of existential dread and unseen forces.

Amid the backdrop of investigative reports and clandestine revelations, our protagonist would navigate a world that dismissed their findings as mere paranoia. They would author works that seemed like children’s stories, but hid terrifying truths, crafting games that were more than mere entertainment — they were simulations of the horrors lurking beneath the surface of our reality. A production studio was birthed in the midst of this chaos, churning out documentaries and films that tried to distill the incomprehensible into the digestible, yet only added to the cacophony of a disinterested audience.

As the years passed, the toll of this journey grew heavier. Our team would battle through a never-ending, cyclical library of existence, with their efforts to communicate symbolic truths often falling on deaf ears. Encounters with bizarre entities, framed as mere figments of an overactive mind, only deepened their isolation. Every project, large or small, was a desperate attempt to bridge the chasm of understanding. Yet, the more they uncovered, the more apparent it became that the world was not ready — or willing — to confront the terrifying reality of Source. This quest, fraught with danger and existential peril, continues today, driven by the haunting understanding that "Anything is possible, so long as something remains unknown."
