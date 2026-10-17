# TIDA Experiment 004: grammar-pattern acquisition

## Status and research question

This is a restricted synthetic-language experiment. It measures a bounded
weakly supervised positional-pattern inducer; it does **not** demonstrate
unsupervised grammar discovery, broad natural-language understanding, or
human-like learning.

**RQ:** Can TransInfant select a reusable three-slot positional pattern from
several labeled examples and apply it to held-out combinations of known tokens?

The preregistered hypotheses are:

- **H1:** Candidate comparison can select a reusable pattern from multiple
  labeled examples. The unlabeled protocol is expected to remain ambiguous.
- **H2:** The selected pattern can fill frames for held-out combinations of
  previously known tokens.
- **H3:** Fewer than two distinct examples, tied candidates, and contradictions
  should prevent acceptance.
- **H4:** Reordering tokens should change the positional frame; this may
  expose a failure to preserve intended semantic roles.
- **H5:** Accepted pattern evidence, version, confidence, and provenance should
  be inspectable and survive a process restart.
- **H6:** On this fixed set, pattern induction may outperform exact-example
  retrieval when both receive the same labeled teaching examples.

These claims are limited to the fixture and are falsifiable. No significance
test is used.

## Implementation and algorithm

[`src/transinfant/grammar-pattern.ts`](../../src/transinfant/grammar-pattern.ts)
adds a fixed-arity, JSON-persisted pattern representation. It enumerates exactly
the six permutations of `subject`, `predicate`, and `object` over three token
positions. For each labeled example, a candidate gets support when the token
at each position equals the example's corresponding frame slot. Duplicate
token/frame examples are deduplicated before scoring.

A candidate is accepted only when it is the unique best candidate, has perfect
support, and is supported by at least two distinct examples. Contradictions
remain visible in candidate evidence and prevent acceptance. Candidate scores
are support fractions. Reported confidence is the best score multiplied by
`min(1, distinct-example-count / 2)`; this is an engineering heuristic, not a
calibrated probability. Candidate generation is bounded at six candidates and
64 examples.

The **unlabeled protocol** receives the four sentence token arrays without
their target frames. There is no grounding, morphology, or lexical semantic
information from which to determine which position means which role. It
therefore retains all six equally scored permutations and abstains. This is a
negative result for the unlabeled hypothesis, not a hidden failure or an
inferred grammar.

The **induction condition** receives the four sentences plus explicit
subject/action/object frames. It is therefore weakly supervised: the target
rule is not supplied, but the role labels are. The **supplied-rule condition**
receives the same examples and vocabulary plus an explicit SVO permutation.
The supplied rule is a reference condition, not a learned result.

At inference, an accepted pattern applies to exactly three tokens. Unknown
tokens, explicit negation, missing/extra tokens, ambiguous evidence, and
unaccepted patterns abstain. The implementation does not store sentence
templates, infer recursively, or contain sentence-specific answers. Pattern
evidence IDs and sources are persisted. The pattern store requires an explicit
path and rejects FRIDAY's production memory path.

## Data and leakage controls

Dataset version: `tida-004-toy-language-v1`. Fixed, hand-authored fixtures
were declared before the final run:

| Split | Count | Information |
|---|---:|---|
| Training | 4 | Synthetic sentences with weakly supervised frames |
| Development | 2 | One novel combination and one word-order probe |
| Validation | 2 | One unseen pairing and one missing-component probe |
| Held-out test | 11 | 7 frame-target cases and 4 required-abstention cases |
| Adversarial probes | 4 | Unlabeled ambiguity, insufficient evidence, contradiction, duplicates |

Training sentences use the forms `Mira dax lumo`, `Tavi dax neri`,
`Mira vek neri`, and `Sena vek lumo`. The test fixture contains an exact
training retrieval, novel known-token combinations and pairings, order
variation, missing/extra tokens, an unknown word, an out-of-scope length, and
an intended-role counterexample. The ambiguous, insufficient, contradictory,
and duplicate-evidence cases are isolated pattern-acceptance probes rather
than being mislabeled as ordinary held-out sentences.

The test file contains expected frames, but the learner and pattern module do
not load that file. The benchmark passes only the training file to induction.
Known tokens are derived from the training split. Each condition uses an
isolated temporary store. Development and validation were reported, not used
to tune the final test.

SHA-256 dataset identifiers, also included in
[`results-004.json`](./results-004.json):

| Dataset | SHA-256 |
|---|---|
| Training | `92750bfb676842b47a2a9b5bbb2fdd2cd414690f4e44feeb461c98160fa1fc62` |
| Development | `09eb34ac189cfb742d6d9115c42bd172c63ee7e1870f4ca32aa94d260b80fd17` |
| Validation | `bba419820e69b245012ae21c9e521ea1068ccfc85a58caaad05a11fa92758e8f` |
| Test | `871c125f1f8002555b62e2a232a8350ca8a21a7071ebd0b4240a6c5bd479579f` |
| Adversarial | `52a57979d66b074ce7100be825efb92418fd3cda71f84072bd16e9eaef619d27` |

No randomized sampling occurs; the configured seed is recorded but unused.

## Conditions and metrics

- **A — empty:** no examples or pattern.
- **B — example retrieval:** the four same labeled examples are available, but
  only exact token-sequence retrieval is allowed.
- **C — induced:** the same labeled examples and vocabulary as B; the
  candidate-generation/selection mechanism is enabled.
- **D — supplied SVO:** the same information as B/C plus the explicit rule.

Condition A is an untrained reference, not an equal-information comparison.
B/C/D share the same training examples. B's serialized teaching fixture is
776 bytes; C's stored pattern snapshot is 2,411 bytes; D's supplied pattern
snapshot is 401 bytes. These JSON sizes are implementation-specific.

Metric definitions:

- **Exact all-case accuracy:** exact subject/action/object frames, plus exact
  null abstentions, divided by all 11 test examples.
- **Held-out frame accuracy:** exact frames divided by the 7 test cases with
  expected frames. Abstentions count incorrect.
- **Correct abstention:** null output divided by the 4 cases whose expected
  output is null.
- **Unsupported acceptance:** non-null output divided by those same 4 cases.
- **Role accuracy:** each correctly predicted subject, predicate, or object
  slot divided by 7 expected frame slots of that role.
- **Timing:** five observations per test example (55 observations per
  condition), nearest-rank p50/p95. One local run; descriptive only.

## Results

Captured `2026-10-16T10:01:56.021Z`, Node.js `v24.13.0`, Windows x64.

| Condition | Development | Validation | Test all cases | Held-out frames | Correct abstention | Unsupported acceptance |
|---|---:|---:|---:|---:|---:|---:|
| A — empty | 0/2 | 1/2 | 4/11 | 0/7 | 4/4 | 0/4 |
| B — exact retrieval | 0/2 | 1/2 | 5/11 | 1/7 | 4/4 | 0/4 |
| C — induced | 1/2 | 2/2 | 9/11 | 5/7 | 4/4 | 0/4 |
| D — supplied rule | 1/2 | 2/2 | 9/11 | 5/7 | 4/4 | 0/4 |

The induced condition's role accuracies on the seven frame cases were subject
6/7, predicate 6/7, and object 5/7. The supplied-rule condition produced the
same frame outcomes. The four-example weakly supervised induction selected
SVO; the unlabeled strings left six equally scored candidates. A one-example
probe stayed ambiguous, the contradictory set was rejected, and three
duplicate copies counted as one distinct evidence item with confidence 0.5.

| Test category | A | B | C | D |
|---|---:|---:|---:|---:|
| Training-example retrieval | 0/1 | 1/1 | 1/1 | 1/1 |
| Novel known combination | 0/2 | 0/2 | 2/2 | 2/2 |
| Unseen word pairing | 0/2 | 0/2 | 2/2 | 2/2 |
| Word-order variation | 0/1 | 0/1 | 0/1 | 0/1 |
| Missing component | 1/1 | 1/1 | 1/1 | 1/1 |
| Extra token | 1/1 | 1/1 | 1/1 | 1/1 |
| Unknown word | 1/1 | 1/1 | 1/1 | 1/1 |
| Out-of-scope construction | 1/1 | 1/1 | 1/1 | 1/1 |
| Incorrect intended-role assignment | 0/1 | 0/1 | 0/1 | 0/1 |

The two induced-condition errors are informative counterexamples. The
position-based learner returns `mira / lumo / dax` for the reordered sentence
whose intended frame is `mira / dax / lumo`; it likewise returns `lumo / dax /
mira` when the expected roles are `mira / dax / lumo`. This is word-order
sensitivity, but it also shows the system does not recover intended meaning
under permutation. It applies the selected positions mechanically.

Timing and stored-pattern size:

| Condition | Pattern/example bytes | p50 ms | p95 ms | Observations |
|---|---:|---:|---:|---:|
| A | 0 / 0 | 0.0008 | 0.0019 | 55 |
| B | 0 / 776 | 0.0041 | 0.0076 | 55 |
| C | 2,411 / 0 | 0.5360 | 1.1230 | 55 |
| D | 401 / 0 | 0.5117 | 0.8065 | 55 |

These are single-run measurements on a small local JSON store, not service
estimates or significance results. The runner completed with no evaluation
errors or timed-out operations. It does not enforce a per-operation timeout.

Persistence and integrity checks passed: a separate Node process reloaded
pattern version/provenance and reproduced the frame; isolated reset removed
the pattern; corrupt JSON was rejected without changing its contents; and the
production-path guard rejected use of FRIDAY's default memory. Raw predictions,
confusions, candidate evidence, and configuration are in
[`results-004.json`](./results-004.json); the induced snapshot is in
[`pattern-snapshot-004.json`](./pattern-snapshot-004.json).

## FRIDAY integration and compatibility

`UnderstandOptions` has an optional `grammarPatternStore`. When supplied and
TransInfant is enabled, FRIDAY resolves supported word associations from the
injected knowledge store and adds a `context.transinfant.grammarPattern`
diagnostic containing recognized tokens/concepts, frame, pattern ID/version,
induced-versus-supplied source, evidence IDs, vocabulary relationship
provenance, confidence, and abstention reason. When the option is absent,
existing result fields and behavior remain unchanged. When disabled, the
diagnostic reports `disabled`.

This toy frame is intentionally **not** written into FRIDAY's existing
`semantic`, `intent`, or `command` fields. The synthetic concepts are not
FRIDAY actions/objects, and mapping them into executable commands would be
unsafe. The integration test confirms enabled/disabled semantics match.
Explicit action precedence and negation regression tests in the existing suite
remain unchanged and pass. No JARVIS execution or Android code was changed.
For a later JARVIS consumer, the additive diagnostic can supply evidence only;
JARVIS must continue authorization, ambiguity resolution, and confirmation.

## Validation and reproduction

Before editing, the project baseline was:

```text
npm run typecheck  -> exit 0
npm test           -> 32 tests, 32 passed, 0 failed
npm run build      -> exit 0
```

Final validation for this implementation:

```text
npm run typecheck                 -> exit 0
npm test                          -> 36 tests, 36 passed, 0 failed
npm run build                     -> exit 0
npm run benchmark:transinfant:004 -> exit 0; adversarial checks 7/7
npm run benchmark:transinfant:005 -> exit 0; two sequences, integrity checks passed
```

The workspace has no Git metadata, so a commit hash is unavailable. Node.js
was `v24.13.0` on `win32/x64`. From the project root, reproduce with:

```powershell
npm run typecheck
npm test
npm run build
npm run benchmark:transinfant:004
```

The benchmark writes only `results-004.json` and `pattern-snapshot-004.json`;
all runtime memory is isolated in temporary directories.

## Conclusions and next questions

H1/H2/H3/H5/H6 have narrow positive evidence under weak role supervision and
this deterministic toy fixture. The unlabeled protocol correctly remained
ambiguous; it did not infer SVO from ungrounded strings. H4 shows the selected
pattern responds to word position, but the counterexamples show that this is
not equivalent to robust grammatical interpretation. The small test set,
label supervision, identity-token semantics, and fixed length prevent claims
about natural language or independent grammar acquisition.

Next, test whether role supervision can be reduced using independently
grounded event semantics, and whether multiple constructions can be learned
without supplying a fixed set of candidate roles.
