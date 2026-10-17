# TransInfant for FRIDAY: an initial relational-learning study

## Status and research question

This document records an experimental vertical slice, not evidence of human-like
or autonomous development. The research question is whether explicit, typed
relations over locally learned symbols can help FRIDAY interpret combinations
not stored as complete utterance examples.

The implemented hypothesis is narrow: after teaching an action alias and an
entity category independently, a bounded relational store can combine them to
produce a typed FRIDAY action/object candidate. This experiment does not test
whether FRIDAY can discover facts without instruction.

## Baseline and integration

The existing request flow is `src/api/app.ts` -> `src/nlu/friday.ts` ->
normalization and wink analysis -> entity extraction -> conversation reference
resolution -> the embedding/lexical/keyword hybrid intent engine -> dialogue
state -> the legacy `NLUResult`. Transformers.js loads
`Xenova/all-MiniLM-L6-v2` at runtime; the semantic engine can therefore require
a first-run model download. The existing /health and /understand API routes
remain available, including their `/api` aliases.

TransInfant is separated under `src/transinfant/`. The JSON-backed local store
is used instead of adding a native SQLite dependency: this keeps the project
offline and dependency-compatible, while limiting this prototype to a small
single-process knowledge base. Runtime knowledge is in `.friday/`, excluded
from version control. Conversations and ordinary user utterances are not
automatically written to that store.

The FRIDAY adapter is disabled unless `FRIDAY_TRANSINFANT=true`. It only fills
missing action/object fields, requires accepted explicit or feedback-sourced
relationships, rejects ambiguous candidates, caps its confidence at 0.85, and
does not execute external actions. Its status and evidence are exposed in the
existing `context.transinfant` diagnostics. If the store cannot be read, the
baseline result remains available and the context reports `degraded`.

## Representation and learning procedure

- A concept is an ID, a display label, and a set of typed string attributes.
- Symbols are normalized labels or aliases pointing to a concept.
- Relationships have subject, extensible predicate, object, provenance,
  confidence, timestamp, experience ID, and a status.
- Supported prototype inference is composition of one `equivalent-to`
  relationship from a matched action symbol and one `is-a` relationship from a
  matched entity symbol. Candidate/inferred facts are not used for interpretation.
- `equivalent-to` is functional per subject in this first version. Explicit
  conflicts are rejected. Feedback can supersede a conflicting fact; reverting
  that feedback restores the previously superseded relationship. Other
  predicates, including `has-property`, may have multiple objects.
- Relationship confidence defaults to 1 for explicitly supplied facts and is
  multiplied by a fixed 0.85 adapter factor. When both action and object are
  learned, the lower field confidence is used. This conservative score is an
  engineering heuristic, not a calibrated probability.
- Store sizes are bounded (1,000 concepts, 2,000 symbols, 5,000 relationships,
  and 2,000 recent learning events). Updates are serialized, written through a
  temporary file, and renamed into place.

Example experience:

```ts
await learnExperience({
  id: "my-exp-1",
  source: "explicit-user-teaching",
  entities: [
    { id: "summon", label: "summon" },
    { id: "open", label: "open" },
    { id: "editor", label: "editor" },
    { id: "application", label: "application" }
  ],
  relationships: [
    { subject: "summon", predicate: "equivalent-to", object: "open", source: "explicit" },
    { subject: "editor", predicate: "is-a", object: "application", source: "explicit" }
  ]
});
```

`learnExperience`, `inspectKnowledge`, `revertExperience`, and
`resetKnowledge` are local developer interfaces. They are not exposed as
unauthenticated HTTP administration endpoints.

## Experiment protocol

Run `npm run benchmark:transinfant`. It uses a temporary store and a fixed,
hand-authored synthetic curriculum. The curriculum teaches `summon` equivalent
to `open`, `reveal` equivalent to `show`, `editor` as an `application`, and
`grid` as a `spreadsheet`. It does not teach full utterances.

The eight listed evaluation inputs are the held-out set. The four novel
combinations (`summon editor`, `reveal grid`, `reveal editor`, `summon grid`)
are not present as training examples. `open document` and `show spreadsheet`
are baseline controls. The baseline uses the complete existing `understand()`
pipeline with TransInfant disabled; the integrated condition uses the same
pipeline and store-backed adapter. Exact-frame accuracy requires both action
and object to match. This is a small demonstration set, not a statistically
representative language benchmark. The comparison uses independently taught
relational facts in the integrated condition, so it measures compositional use
of supplied knowledge, not equal-information classification performance.

No random sampling is used, so a random seed is not applicable. Latency and
memory measurements are from a single local run and are descriptive only.
Latency is measured after one warm-up per sample and includes the JSON store
read on the integrated path. Cold first-request model startup is reported
separately.
Confidence intervals are not reported due to the tiny, deterministic sample.

## Results

One measured run was completed with `npm run benchmark:transinfant` on Node
v24.13.0. The 8-example exact-frame accuracy was 2/8 (25%) for baseline and
8/8 (100%) for the integrated path. Both conditions got the 2 standard-object
controls right. The baseline got 0/6 custom-entity examples; the integrated
path got 6/6. The four unseen cross-combinations were 0/4 baseline and 4/4
integrated. This is evidence that this implementation composes these particular
explicit facts on this fixture, not a generalization estimate for natural
language.

| Measure | Baseline | Integrated |
|---|---:|---:|
| Exact action/object frames | 2/8 (25%) | 8/8 (100%) |
| Action accuracy | — | 8/8 (100%) |
| Object accuracy | — | 8/8 (100%) |
| Warm P50 latency | 0.769 ms | 3.552 ms |
| Warm P95 latency | 285.546 ms | 287.508 ms |
| Persistent knowledge size | — | 4,525 bytes |

The measured cold first baseline request, including embedding model startup,
was 1,598.069 ms. Warm P95s were highly variable in this single short run and
should not be used as service-level estimates. The integrated path adds a
read-and-score step and was slower at the median. See
[`results.json`](./results.json) for the run values and sample-level outputs.

## Ablations and open evaluation work

Not yet run: learned-memory-only retrieval, composition disabled, context-only
integration, incremental retention across a broader curriculum, entity
extraction precision/recall, contradiction rates on adversarial data, multi-run
latency distributions, and resource use under larger stores. The tests cover
basic persistence, contradiction handling, feedback replacement, reversion,
unverified-fact exclusion, explicit-action precedence, and a single held-out
composition. They are correctness checks, not a broad benchmark.

The store's JSON persistence is suited only to this small local prototype.
Cross-process locking, schema migrations beyond version 1, expiry policies, and
conflict resolution beyond the specified functional predicates remain future
work. The language-matching layer is deliberately limited to aliases with
token-boundary matching. No claim is made that it understands arbitrary
paraphrases, learns concepts autonomously, or matches a generative model's
open-ended response ability.

## Related work

The implementation is an inspectable symbolic relational memory with bounded
rules, not a reproduction of a developmental cognition model. Collins and
Loftus's spreading-activation account is relevant background for relational
semantic memory, but the current prototype does not implement their cognitive
model or test psychological predictions.

Reference:

- Collins, A. M., & Loftus, E. F. (1975). A spreading-activation theory of
  semantic processing. *Psychological Review, 82*(6), 407–428.
  https://doi.org/10.1037/0033-295X.82.6.407
