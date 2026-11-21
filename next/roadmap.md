# Roadmap

What comes next for src.eco, in the order it should be built. Each step ends
in something that can be measured, and each one can kill the plan.

**Stale below the line.** These steps assume the objective in
[witness.md](witness.md), which is withdrawn. The live question is in
[crawl.md](crawl.md): its probe has run, and what it left open comes before
anything here. The transport and counter steps survive either way.

---

- [ ] **Harder probe**
      The first probe shows the mechanism works on documents that are easy to
      tell apart. Before any site code: run it on members who wrote to the
      same prompt, with thirty or more of them, and with the abstain threshold
      and vote rate limits turned on. If witness accuracy does not climb, stop
      here and change the record (exact local gradient, largest coordinates)
      before building anything on top. See [witness.md](witness.md),
      "Falsifiers".

- [ ] **Counters in the tab**
      Port the probe's core to the site as a module with no dependencies:
      integer generator, counters, records, apply, digest. One gate: two
      different browser engines fed the same records in different orders
      print the same digest.

- [ ] **The wire**
      A tracker under the site's own domain, and a thin client that announces
      on the founding document's infohash and opens data channels. Records
      hop; a new peer asks a neighbor for the current snapshot and the tail of
      the log. Chat moves onto the same channels. Both GUN relays retire when
      this carries chat, and not before: Praxis and the editor extension still
      read them.

- [ ] **Signature at the door**
      A visitor joins by offering a document. The tab extracts its text,
      holds back the last quarter as witness, and announces its hash. Until
      then a visitor can read and chat but cannot vote. The privacy notice
      lives here.

- [ ] **The ticker tells the truth**
      The state line already shows training numbers. It shows the member's
      witness score, nearest members, distance from center, and the swarm's
      mean pairwise distance.

- [ ] **Daemons**
      A variable-order chain per member document, seeded by member and UTC
      slot, printing into the terminal. Then attribution: the twin names the
      member behind each line and keeps score.

- [ ] **Sticky registers and snapshots**
      One vote per member per key, value by plurality. First uses: the
      snapshot pointer and the station list.

- [ ] **Radio on torrents**
      Stations become torrents with web seeds. IPFS gateways go.

- [ ] **The private residual**
      A member's own small correction on top of the shared counters, trained
      in the tab, never published. This is the twin proper.

---

Retired by this plan: GUN, the IPFS gateways, ode and TensorFlow.js in the
tab, and the server-hosted chat bots.
