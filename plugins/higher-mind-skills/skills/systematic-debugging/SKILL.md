---
name: systematic-debugging
description: >
  Systematyczny 4-fazowy debugging root-cause zamiast zgadywania i latania objawow.
  Use whenever a bug, error, failing test, crash, regression or "nie dziala" appears.
  Trigger on: "bug", "error", "nie dziala", "wykrzacza sie", "failing test", "crash",
  "regresja", "czemu to nie dziala", "debug", stack trace pasted in conversation.
---

# Systematic Debugging (root-cause, nie objawy)

Zakaz "szybkich strzalow": nie zmieniaj kodu, dopoki nie przejdziesz faz 1-2.
Jedna proba naprawy bez zrozumienia przyczyny = dlug; trzy = chaos.

## Faza 1 — REPRODUKCJA (fakt, nie relacja)
- Odtworz blad samodzielnie (komenda/test/route). Nie debuguj z opisu.
- Zapisz minimalny przypadek reprodukcji — najlepiej jako failing test OD RAZU.

## Faza 2 — DIAGNOZA (zawez, potem wnioskuj)
- Przeczytaj CALY komunikat bledu i stack trace — najpierw dolna ramka wlasnego kodu.
- git log/diff: co sie zmienilo od ostatniego dzialajacego stanu? (bisect gdy trzeba)
- Postaw 2-3 hipotezy, uszereguj wg prawdopodobienstwa, weryfikuj po kolei
  (logi/breakpoint/print na granicach warstw). Kazda odrzucona hipoteza = notatka czemu.
- Stop-warunek: potrafisz dokonczyc zdanie "Blad wystepuje, bo X robi Y, gdy Z".

## Faza 3 — NAPRAWA (przyczyna, nie objaw)
- Napraw przyczyne w JEDNYM miejscu; zadnych try/catch maskujacych i "if null return".
- Failing test z Fazy 1 musi przejsc; caly suite musi zostac zielony.

## Faza 4 — DOMKNIECIE
- Sprawdz grep-em, czy ten sam wzorzec bledu nie siedzi gdzie indziej w repo.
- Jesli przyczyna byla nieoczywista: 1-linijkowy wpis do docs/REVIEW-LEARNINGS.md.
- W odpowiedzi: przyczyna -> dowod (exit 0) -> co zabezpiecza przed regresja.
