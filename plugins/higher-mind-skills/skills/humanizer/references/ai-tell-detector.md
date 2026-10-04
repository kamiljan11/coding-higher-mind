# The AI-Prose Tell Guide (2026)

A field manual for spotting machine-written English and un-writing it. Each tell gets three things: why it pings as AI, a bad example, and the human fix. The tells rarely appear alone — AI prose is a *cluster* of these, layered until every sentence is doing a little performance. Humans do one or two of these occasionally. Machines do all of them, all the time, evenly.

---

## 1. Em-dash overuse and em-dash-as-drama

**Why it reads as AI.** The em dash is the model's favorite joint. It uses dashes to bolt a dramatic afterthought onto every other sentence, always for the same rhetorical beat: setup — *pause* — payoff. One or two per page is normal human writing. One per sentence is a fingerprint. The tell isn't the punctuation mark itself; it's the *monotony of the move* it performs.

**Bad:**
> The results were clear — and they changed everything. We shipped it — a decision that would define the quarter — and never looked back.

**Human:**
> The results were clear, and they changed everything. We shipped it that quarter and never looked back.

**uzytkownik's rule, set 2026-08-16: zero em dashes. No exceptions, no "one or two per page".** The reasoning is simpler than style. The character is not on a keyboard. A person typing a quick email produces a comma, a period, or at worst a plain hyphen, never `—`. So its presence is a fingerprint on its own, independent of how the sentence reads. Convert every one to a comma, a period, or parentheses, or split the sentence in two. A hyphen used as a dash (` - `) is the same tic wearing a hat and is banned too. Hyphens inside words are fine.

---

## 2. The "it's not X, it's Y" / "not just X but Y" correlative

**Why it reads as AI.** This construction manufactures profundity for free. It sounds like a distinction is being drawn, but usually X and Y are the same size and the "reveal" is empty. Models reach for it because it *feels* like insight-shaped text. Real writers earn a contrast; they don't stamp it on reflexively.

**Bad:**
> This isn't just a feature, it's a philosophy. It's not about the code, it's about the people who use it.

**Human:**
> This feature changes how the team thinks about permissions. Users notice it within a day.

If the contrast is real, state both halves plainly and let the reader see the gap. If it isn't real — and it usually isn't — cut the setup and just say the thing you actually mean.

---

## 3. Rule-of-three / tricolon addiction

**Why it reads as AI.** Three parallel items feel complete and rhythmic, so the model defaults to triples everywhere: three adjectives, three clauses, three examples. Reached for once, a tricolon lands. Reached for in every paragraph, it turns prose into a metronome. Watch for the *padded* third item especially — the one added only to make three.

**Bad:**
> It's fast, reliable, and scalable. We build tools that inform, empower, and transform. This will save time, reduce cost, and drive growth.

**Human:**
> It's fast and it holds up under load. We build tools people actually keep using. This cuts our support time roughly in half.

Vary the count. Use two items, or four, or one. Kill the third item when it's just there for the beat. Trade the abstract triple for one concrete claim.

---

## 4. Mechanically balanced sentence pairs

**Why it reads as AI.** The model loves a seesaw: a clause on the left, a mirrored clause on the right, weights matched. "The more you X, the more you Y." "Where there's A, there's B." It reads as designed rather than said — nobody talks in perfectly counterweighted halves. The symmetry is the tell.

**Bad:**
> The harder the problem, the sweeter the solution. When the stakes rise, so does the reward.

**Human:**
> Hard problems are more satisfying to solve. Usually. Sometimes they just grind you down and the payoff is that you're finally done.

Break the symmetry on purpose. Let one half be longer, messier, or undercut the other. Add a hedge or a caveat that ruins the neat balance.

---

## 5. Every paragraph ending on a neat aphorism / mic-drop

**Why it reads as AI.** Models close paragraphs like they're landing a TED talk — each one resolves into a tidy, quotable, slightly grand final line. Real writing lets most paragraphs end on a detail, a qualifier, or just… the last piece of information. When *every* paragraph goes out on a profundity, the profundities cancel out and the whole thing reads as hollow.

**Bad:**
> …and that's how the migration worked. Because in the end, the best systems are the ones you never have to think about.

**Human:**
> …and that's how the migration worked. It took two weekends and one rollback. The second weekend was mostly waiting for indexes to rebuild.

Let paragraphs end flat. End on a fact, a number, a boring detail. Save the one genuinely good closing line for the *end of the whole piece*, not paragraph three.

---

## 6. "Here's the thing" / "The truth is" throat-clearing

**Why it reads as AI.** These are fake-intimacy openers. They promise a confession or a hard truth and then deliver an ordinary sentence. "Here's the thing." "The truth is." "Let's be honest." "At the end of the day." They add zero information and pre-announce significance the content doesn't have.

**Bad:**
> Here's the thing: most startups fail. The truth is, execution matters more than ideas.

**Human:**
> Most startups fail. Execution matters more than ideas.

Delete the opener and start on the actual sentence. If the sentence can't stand without the drumroll, the sentence is the problem, not the missing intro.

---

## 7. Over-hedging with "genuinely / actually / honestly / really"

**Why it reads as AI.** The model sprinkles intensifiers to *simulate* sincerity — "genuinely useful," "actually works," "really matters," "honestly surprising." Each one is a little plea to be believed. Piled up, they achieve the opposite: the prose sounds like it's protesting too much. A confident writer just makes the claim.

**Bad:**
> This is genuinely one of the most actually useful tools I've honestly ever really used.

**Human:**
> This is one of the most useful tools I've used. It saved me an afternoon last week.

Cut the intensifier and add evidence instead. "Genuinely useful" → say *what* it did. Replace the adverb with a fact. Keep at most one intensifier per few paragraphs, and only where the surprise is real.

---

## 8. Uniform sentence and paragraph length

**Why it reads as AI.** This is the deepest tell, the one under all the others. Model prose has almost no rhythmic variance — sentences cluster around the same medium length, paragraphs around the same three-to-four-sentence block. Human writing has burst and drag: a 40-word sentence slams into a 3-word one. The flatness of the waveform is what makes AI text feel "smooth" and lifeless even when every individual sentence is fine.

**Bad:**
> The project began in spring with a small team. We spent several weeks planning the architecture carefully. Once the design was ready, we started building the core. The first version shipped after about two months of work.

**Human:**
> The project began in spring. Small team, no budget, a whiteboard full of arrows nobody fully agreed on. We planned for weeks — probably too long. Then we built the core in a frantic month and shipped. It broke on day one.

Read your draft aloud. Where every sentence takes the same breath, break one in half and let another run long. Follow a long sentence with a two-word one. Let one paragraph be a single line.

---

## 9. Participial-phrase pile-ups ("...doing X, doing Y, doing Z")

**Why it reads as AI.** The model tacks trailing `-ing` clauses onto sentences to keep them flowing: "…launched the product, transforming the market, empowering users, setting a new standard." It's a way to cram in more claims without new sentences. It reads as a run-on gerund parade and drains all agency — nobody *does* anything, things are just endlessly *-ing*.

**Bad:**
> We rebuilt the pipeline, cutting latency, improving reliability, enabling new features, and positioning us for scale.

**Human:**
> We rebuilt the pipeline. Latency dropped by half. It stopped falling over on Mondays, and we could finally add the export feature people kept asking for.

Turn each `-ing` tail into its own sentence with a real subject and a plain past-tense verb. Somebody did something. Say who and what.

---

## 10. Abstract-noun soup

**Why it reads as AI.** Models drift up the ladder of abstraction — "leveraging synergies to drive alignment around scalable impact." Nominalizations (verbs turned into nouns: *implementation, utilization, optimization*) stack until no concrete thing is visible. It sounds authoritative and means nothing. Humans writing well stay close to the ground: objects, people, actions, numbers.

**Bad:**
> Our approach prioritizes the facilitation of stakeholder engagement to maximize operational efficiency and value delivery.

**Human:**
> We got the warehouse team and the drivers in one room. They cut the handoff from three steps to one. Deliveries went out an hour earlier.

Hunt nominalizations ending in *-tion, -ment, -ance, -ity* and turn them back into verbs. Ask of every sentence: *who did what to what?* If you can't answer, the sentence is soup.

---

## 11. Restating the same idea two ways

**Why it reads as AI.** The model says a thing, then immediately says it again in slightly different words, often joined by a colon or "in other words." It's padding that masquerades as clarification. "It was fast. In other words, it didn't take long." The second clause carries no new information.

**Bad:**
> The rollout was seamless — it went smoothly without any issues. Adoption was immediate, meaning people started using it right away.

**Human:**
> The rollout went smoothly. People were using it within the hour.

Pick the better of the two phrasings and delete the other. If the restatement adds a real nuance, keep only the nuance. One idea, said once.

---

## 12. The "which is exactly why..." reveal

**Why it reads as AI.** This is a self-satisfied connective that presents an ordinary cause as a triumphant deduction: "…which is exactly why we built it this way," "…and that's precisely the point." It stages a payoff the reader didn't ask for and treats a mild explanation as a gotcha. Related tics: "and that's no accident," "which is the whole point."

**Bad:**
> Users hate friction — which is exactly why we removed the signup form. That's not a coincidence. That's by design.

**Human:**
> Users hate friction, so we dropped the signup form. Conversions went up about 20%.

Replace the theatrical connective with a plain "so" or "because," and back it with a result. Cut "that's no accident / by design" entirely — it's applause for yourself.

---

## 13. Overuse of colons

**Why it reads as AI.** The colon is the model's setup-punchline machine, cousin to the em dash. It uses colons to introduce lists, restatements, and dramatic single-word reveals constantly: "There's one problem: everything." The colon promises the reader something crucial follows, and when it fires every few sentences the promise goes stale.

**Bad:**
> The goal was simple: win. But there was a catch: nobody agreed on what winning meant. The solution: talk it out.

**Human:**
> The goal was simple. We wanted to win — but nobody agreed on what winning meant, so we spent an afternoon hashing it out.

Reserve colons for genuine lists and real setups. Convert most to periods or commas. Never use a colon just to make a single word land harder.

---

## 14. Too-perfect parallelism

**Why it reads as AI.** Beyond tricolons, the model matches grammatical structures with unnatural precision across whole passages — every bullet the same shape, every clause the same cadence, anaphora ("We believe… We believe… We believe…") deployed like a template. Deliberate parallelism is a real rhetorical tool. Reflexive, wall-to-wall parallelism is machinery showing through.

**Bad:**
> We listen to learn. We build to last. We ship to win. We grow to lead.

**Human:**
> We listen more than we'd like to admit. We build things to last, mostly because rewriting is miserable. And we ship — even when it's ugly — because a shipped ugly thing beats a perfect idea.

Break the pattern before it locks in. After two parallel items, make the third a different length or structure. Let one clause sprawl and one stop short.

---

## 15. Signposting: "Importantly," "Notably," "Crucially"

**Why it reads as AI.** The model narrates the significance of its own sentences: "Importantly, …", "Notably, …", "It's worth noting that …", "Crucially, …". These are the writer telling the reader how to feel instead of writing something that produces the feeling. Also in this family: "Interestingly," "Ultimately," "Essentially," "In essence." They're cushions between the reader and the content.

**Bad:**
> Importantly, the fix reduced errors. Notably, it also improved speed. Ultimately, it's worth noting that users were happier.

**Human:**
> The fix cut errors by 90%. It was faster too, and complaints dropped off almost immediately.

Delete the signpost and let the fact carry its own weight. If something is important, make it important by what it says — not by prefixing "Importantly." Cut "ultimately," "essentially," and "in essence" on sight; they almost never survive a reread.

---

## Positive human-writing habits (the fixes, generalized)

- **Vary the rhythm.** Long, winding sentence, then a short one. Then a fragment. The waveform should be jagged, not smooth. This single habit defeats more tells than any other.
- **Write short, blunt sentences.** "It broke." "Nobody knew." "We shipped anyway." A three-word sentence after a long one is the most human move there is.
- **Use fragments.** On purpose. Where it fits.
- **Start sentences with And, But, So.** It's not a grammar error, it's how people actually connect thoughts. And it breaks the model's smooth-connective habit.
- **One idea per sentence — sometimes.** Not always; mix it with the occasional long braided sentence. But when in doubt, split.
- **Concrete over abstract.** Objects, names, numbers, actions. "Three steps to one," not "streamlined the process." If a sentence has no picture in it, it's probably soup.
- **Plain verbs.** *Cut, dropped, broke, built, sent, waited* — not *facilitated, leveraged, optimized, utilized.* Past tense with a real subject doing the acting.
- **Cut throat-clearing.** Delete "Here's the thing," "The truth is," "It's worth noting," "At the end of the day," "Importantly." Start on the actual sentence.
- **Let paragraphs end flat.** End on a boring detail, a number, an unresolved note. Not every paragraph needs a moral. Save one good closing line for the actual end.
- **Kill the reflexive third item.** When a triple appears, check if the third item is real or just there for the beat. Usually cut it.
- **Break your own symmetry.** When two clauses balance too neatly, unbalance them. Add a caveat, an aside, a "usually," a "sometimes not."
- **Say the contrast only if it's real.** Drop "it's not X, it's Y" unless X and Y are genuinely different sizes. Otherwise just say Y.
- **Read it aloud.** Anything you'd never say to a person's face — cut it. The ear catches the metronome the eye misses.

The meta-rule: AI prose fails by being *too even* — even rhythm, even polish, even profundity, every sentence pulling its weight and performing a little. Human prose is uneven. It lags, spikes, undercuts itself, trails off, and occasionally just states a plain fact and moves on. Write toward the unevenness.