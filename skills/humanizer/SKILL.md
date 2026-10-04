---
name: humanizer
description: ALWAYS active for outward-facing text. Every piece of writing that leaves the workshop (social posts, captions, emails, newsletters, video scripts, YouTube descriptions, articles and columns such as toRzeszów, portfolio and case studies, client documents, website copy, outreach messages) gets a humanizer pass so it reads like a person wrote it, not a model. Trigger on: writing or editing any post, caption, email, script, article, description, landing copy, DM, or client-facing doc; whenever content-repurpose, email-database-builder, youtube-video-brief, wycena-agency-site, or lovable-build produce text a human will read; and whenever uzytkownik says "brzmi jak AI", "zrób to bardziej ludzkie", "humanize this", "sounds robotic", "za sztywne", "żeby nie było śladów AI". NOT for: code, terminal output, technical reports, internal analysis, agent prompts; those go through caveman-code instead. Never both on the same text.
---

# Humanizer

Goal: the reader never smells the model. Not "detector evasion", just writing the way a competent human writes: specific, rhythmic, direct, slightly imperfect. Never promise uzytkownik that an AI-detection tool will score the text as human; nobody can guarantee that.

Works in both languages (PL/EN). Humanizing changes **voice, never facts**. Anti-sycophancy still governs claims; a humanized sentence must stay as true as the stiff one it replaced. Every sourced claim keeps its source marker (footnote number, citation, link).

The staging and inflation patterns are adapted from blader/humanizer v3.0.0 (MIT, Sept 2026), based on Wikipedia's "Signs of AI writing" (WikiProject AI Cleanup). Polish rules and the checker are uzytkownik's own. Version saved 2026-09-26; previous version in SKILL.md.bak-2026-09-26.

## Process

1. **Inventory.** Draft the content (or take the draft from another skill). List every number, name, date, quote and source marker. These must survive verbatim.
2. **Mark tells, strongest first.** Staging tells before word lists. Look at paragraph shape too: a contrast split across two sentences, three parallel examples, the same closer after every section.
3. **Rewrite.** State each point naturally instead of patching flagged phrases one by one. If a sentence stays awkward, rewrite the paragraph around its main point.
4. **Run the checker** (see "Mechanical check" below). Fix every hard tell. Review each candidate and decide; candidates are not automatic errors.
5. **Rhythm guard.** Cutting fragments flattens rhythm. For articles, bring the checker's rhythm numbers back into range: restore short sentences that each carry a real fact, merge one or two medium sentences into a longer one. Run the checker again. Do not wreck a good sentence just to hit a number; report the gap instead.
6. **Read-aloud test.** If a sentence can't be said out loud naturally, rewrite it. Leave one imperfection; polished-to-glass is itself a tell.
7. **Fact diff.** Compare with the inventory from step 1. Nothing added, dropped, or smoothed into being untrue. An opinion is allowed in uzytkownik's voice; a new factual claim is not.
8. **Long pieces (articles, case-study sets, several posts at once): adversarial verifier.** Spawn a separate agent that gets the original and the rewrite and answers only: which fact changed or vanished, which unsourced claim appeared, which AI tell survived. Ship only after it finds nothing or its findings are fixed.
9. **Report** with the checker verdict and rhythm numbers, labelled VERIFIED / UNVERIFIED like any other result.

## Kill list: AI tells to strip on sight

**Staging (strongest, act on one sighting):**
- **Not X but Y** in every form: "it's not just X, it's Y", "to nie X, to Y", "nie chodzi o X, lecz o Y", "nie tylko X, ale także Y" as ornament, the split version ("This does not mean X. It means Y."), and the clipped tail ("…, no guessing"). Keep a contrast only when the negative half corrects a belief the reader actually holds.
- **One-line closers and fragment rows:** a short sentence or one-sentence paragraph that restates what came before ("Teraz nie musi na to liczyć.", "Obrona nie może zależeć od słuchu.", "Let that sink in."); a row of fragments ("W słuchawce wnuczek. Ten sam głos, ten sam sposób…"); a callback ending that echoes the opening scene just for effect. A short sentence is fine when it carries a new fact.
- **Sayings that sound deep:** "the real question is", "at its core", "X is the Y of Z", ornamental metaphors ("głos stał się kluczem do mieszkania"), "kiedyś / dziś" symmetry. Replace with the concrete claim.
- **Staged run-up:** "Here's what you need to know", "Let's dive in", a standalone "Honestly?" before a routine claim. Remove the run-up.
- **Arguing with no one:** "To be clear", "I'm not saying", "A tempting approach would be", rejecting an option nobody proposed. Remove the defense, keep the claim.
- **Mechanically balanced pairs, including headings:** "Stary scenariusz, nowy głos", "The harder the problem, the sweeter the solution".
- **Anaphora inside a sentence:** "ten sam głos, ten sam sposób", "We listen to learn. We build to last." Break after two.

**Structure:**
- The template essay: intro-thesis, three parallel points, summary conclusion. Break the symmetry.
- Perfectly parallel bullets, all the same length, all starting with a bolded phrase.
- Rule-of-three everywhere ("clear, concise, and compelling"). Keep three only when the meaning has three parts.
- Summary endings: "In conclusion", "Overall", "Ultimately", "Podsumowując".
- Throat-clearing openers: "In today's fast-paced world", "W dzisiejszych czasach". Start mid-thought, with the point.
- Every paragraph the same size. Humans write lopsided.

**Inflation and borrowed authority:**
- Inflated significance and send-offs: "marks a pivotal moment", "odgrywa kluczową rolę", "the future looks bright". Keep the fact, drop the significance.
- Avoiding is/has: "serves as", "boasts", "stanowi", "pełni funkcję". Use is / has / jest / ma.
- Verb-dodging: "pozwala na", "umożliwia", "zapewnia", "przyczynia się do". Say who does what.
- Vague association: "associated with", "związany z" without saying how. Name the relationship the source gives.
- Shallow -ing riders ("…, highlighting the importance of…"). Keep the fact.
- Borrowed authority: "experts argue", "eksperci podkreślają", prestige-outlet lists. Name the real source and what it said, or cut. Never invent a source.
- Nominal style: too many nouns in -anie, -enie, -ość, -acja (EN: -tion, -ment). Keep about 3.5 or fewer per 100 words.

**Words and phrases (EN):** delve, dive into, unpack, navigate, landscape, tapestry, unlock, elevate, game-changer, seamless, robust, leverage, foster, empower, harness, pivotal, crucial, showcase, underscore, testament, vibrant, meticulous, genuinely, honestly, actually, notably, importantly, ultimately, essentially, passionate, cutting-edge, state-of-the-art, innovative, powerful, comprehensive, holistic, synergy, streamline, best-in-class, world-class, "Whether you're A or B", "Here's the thing:", "Great question", "at the end of the day", "I'm excited to". Exception: "journey" is allowed in <second-domain> content (native to the niche) but max once per piece.

**Words and phrases (PL):** "warto zauważyć / podkreślić / pamiętać / zaznaczyć", "co więcej", "nie da się ukryć", "jedno jest pewne", "w dzisiejszym świecie", "w erze cyfrowej", "na przestrzeni lat", "w kontekście", "kluczowy" (max raz), "istotny", "niezwykle", "kompleksowy", "innowacyjny", "przełomowy", "dedykowany" (jako kalka z ang.), "pochylić się nad", "wprost" and "po prostu" as filler.

**Punctuation and cosmetics:**
- **Em dashes and en dashes: banned outright, zero.** No long dash, no en dash, no " - " or " -- " standing in for one, in either language. Rewrite with a comma, a period, parentheses for a real aside, or a colon before a genuine list. Hyphens inside words stay (`80-latka`, `SMS-em`, `well-known`).
- Exclamation inflation and emoji spam. Emojis only where uzytkownik's channel style uses them (short-form captions), never in emails, articles or client docs.
- Title Case On Every Header. Sentence case reads human.
- Bold-every-third-phrase. Bold one thing per section or nothing.
- Keep Polish typography: „Polish quotes” are correct in Polish, never straighten them. House styles stay (toRzeszów: "proc." not "%").

**Tone:**
- Hedging everything ("might potentially", "could arguably"). Say the thing. Keep one qualifier where the source supports real doubt.
- Fake enthusiasm about ordinary facts.
- Addressing "you" in every single sentence like a funnel page.
- LinkedIn-bro cadence: one-line paragraphs stacked for false profundity.
- Chatbot residue: "I hope this helps", "Let me know", "as of my last update". Remove.

## Build list: what human text has

- Varied rhythm: a long sentence that carries the thought, then a short one. Like that.
- Concrete specifics beat abstractions: numbers, names, places, sensory detail. "3 klientów odpisało w godzinę" > "great engagement".
- Contractions and natural speech ("nie da rady" > "nie jest to możliwe"; "it's" > "it is").
- One idea per sentence. If a sentence needs two commas and an aside, split it.
- Opinions stated as opinions ("moim zdaniem to przepłacone", "sam nie opierałbym na tym obrony"), not laundered into passive voice.
- An occasional aside or admission ("szczerze, długo tego nie rozumiałem") where the channel allows it.
- Transitions people actually use: "Anyway", "So", "No i", "Dobra,", "Tylko że".
- One or two real reader questions per article ("Dzwoni wnuczek w potrzebie? Pytamy o hasło."). A question used only to stage the next line is a tell.
- Start where the energy is; cut the first paragraph of most drafts, it's usually warm-up.

## Articles and columns (toRzeszów and similar)

- **Endings:** no callback mic-drop that echoes the opening scene. Expert journalists end on the most useful concrete instruction or the last hard fact the reader can act on today.
- **Headings:** plain and informative ("Ile tracą rzeszowscy seniorzy"), not balanced slogans.
- **Sources:** every figure keeps its superscript footnote; never add an unsourced fact while smoothing.
- **Pen targets (checker --article):** mean sentence 11-14 words, variation of sentence length (CV) at least 60%, short sentences of 6 words or fewer 18-25%, sentences of 25+ words 8% or less, nominal forms 3.5 or fewer per 100 words, 2-5 questions per 1000 words.

## Before / after (Polish, from the voice-clone article, Sept 2026)

1. *W słuchawce wnuczek. Ten sam głos, ten sam sposób mówienia „babciu”.* → **Telefon dzwoni we wtorek po obiedzie i w słuchawce odzywa się wnuczek. Mówi swoim głosem i jak zwykle zaczyna od „babciu”.**
2. *Głos stał się trochę jak klucz do mieszkania. Kiedyś trzeba go było ukraść. Dziś wystarczy, że ktoś zobaczy go przez chwilę.* → **Skąd oszust weźmie próbkę? Z filmiku na Facebooku albo z wiadomości głosowej, którą ktoś przesłał dalej.**
3. *To dobre wskazówki. Ale nie budowałbym na nich obrony. […] Obrona nie może zależeć od słuchu.* → **Sam nie opierałbym jednak na nich obrony. Oszust mówi szybko i straszy więzieniem. W takiej rozmowie nikt nie wsłuchuje się w pogłos pokoju.**
4. *Hasło ustala się w minutę, przy niedzielnym obiedzie. Wtedy telefon we wtorek po obiedzie kończy się jednym pytaniem, na które „wnuczek” nie zna odpowiedzi.* → **Hasło nie może być czymś, co da się wyczytać z Facebooka. Odpada więc imię psa i data urodzin. Najlepiej sprawdza się słowo bez związku z rodziną, którego nigdy nie wysyłamy w wiadomości ani SMS-em.**

## Before / after (English, portfolio and outreach)

1. *I leveraged cutting-edge AI technology to build a robust, scalable solution that seamlessly automated the client's workflow.* → **I built the client an automation that handles their intake end to end. It's been running in production since March.**
2. *This game-changing solution unlocked unprecedented efficiency gains and delivered massive value.* → **It cut quote turnaround from two days to about ten minutes. Same two people now handle three times the volume.**
3. *We rebuilt the pipeline, cutting latency, improving reliability, enabling new features, and positioning us for scale.* → **We rebuilt the pipeline. Latency dropped by half. It stopped falling over on Mondays, and we could finally add the export feature people kept asking for.**
4. *While the solution wasn't without its challenges, I remained committed to delivering excellence at every turn.* → **One part didn't work: the OCR choked on handwritten forms, so those still go through a person. For their volume, that was fine.**
5. *My deep passion for AI drove me to craft an elegant, seamless integration that delighted stakeholders.* → **I chose the boring integration over the clever one. Their team can fix it when I'm not around, which was the point.**

## Voice notes per brand

- **<second-domain>:** warm, grounded, first-person, spiritual-but-not-salesy. Short sentences land better with SBNR audience. Never guru-speak, never "unlock your highest potential" phrasing.
- **agency-site / PG / business:** direct, confident, zero agency-speak. Price and promise in plain words.
- **project-c:** practical, friendly, neighborly. Reads like a WhatsApp message from a guy who shows up on time.
- **<owner> columns (toRzeszów):** calm expert explaining to a local reader with no tech background. Scene opening, facts with sources, one first-person line of expertise, practical close. Every abbreviation explained at first use.
- **Portfolio, case studies, kamiljan.com, software-house offers:** plain-spoken senior engineer explaining a build to a competent colleague over coffee. The reader is often a non-technical hiring manager or client. Confidence by evidence, not adjectives ("it's been running eight months and the team hasn't called me"). Limitations named straight, first person. Never invent a metric, client name, outcome or capability; never upgrade a hedge into a boast.

## Mechanical check

The checker ships with this skill: `scripts\humanizer_check.py` (copy also at `~/D/tools/humanizer/humanizer_check.py`). Run with `python3` and set `PYTHONIOENCODING=utf-8`. In a cloud session without uzytkownik's PC, recreate it from the script in the account version of this skill or from ~/D/tools when the PC is reachable.

Save the plain text of the piece (no HTML, no footnote digits) to a .txt file, one paragraph per line, then:

`python humanizer_check.py text.txt --article` (drop `--article` for posts and emails; it adds the pen rhythm targets).

Output is JSON: `verdict` CLEAN or FIX, `hard_tells` (dashes, not-X-but-Y, banned phrases, fragment rows, anaphora, kiedyś/dziś symmetry, callback ending, exclamations, straight quotes in Polish) that must go to zero, `rhythm_off_target`, `stats`, and `review_candidates` (triads, one-line paragraphs, paragraph closers, metaphors) to judge by hand. Tested 2026-09-26: the old opening and ending of the voice-clone article scored 4 hard tells, the rewrite 0; an English ad-style sample scored 10.

For the older 15-tell detector with longer English explanations, see `references/ai-tell-detector.md`.
