# TIDA Experiment 003: symbol-to-word learning

## Status and research questions

This is a small synthetic implementation and evaluation, not evidence of
human-like learning or general language understanding.

- **RQ1:** Can explicit symbol and word associations be recognized, retrieved,
  and traced to the teaching experience that supplied them?
- **RQ2:** Does a supplied composition rule apply those associations to
  previously unseen word combinations?
- **RQ3:** Does the system abstain for unknown or ambiguous associations and
  unsupported role sequences?
- **RQ4:** Do associations, corrections, and reversals survive persistence and
  isolated reset checks?

The falsifiable hypotheses H1-H6 and the versioned metric definitions are also
recorded in [`experiment-003.json`](./experiment-003.json). Results below do
not establish independent rule discovery: the only composition rule is
explicitly supplied.

## Implementation and representation

[`src/transinfant/vocabulary-learning.ts`](../../src/transinfant/vocabulary-learning.ts)
provides explicit teaching, exact surface recognition, word/symbol lookup,
provenance, ambiguity and uncertainty reporting, inspection, snapshot export,
reset, and a supplied-rule composition operation. It maps each input entity
(word or symbol) to a meaning concept through the existing TransInfant
`denotes` relation. Input identity and meaning are separate: a recognized
surface can still have an unknown or uncertain meaning. Aliases resolve to the
same input entity.

Accepted `denotes` relationships carry the existing learner's experience ID,
source, confidence, timestamp, and accepted status. Inferred associations remain
candidates. `denotes` is treated as a functional relation: non-feedback
contradictions are rejected, explicit feedback supersedes the prior accepted
association, and the existing reversible event API can restore it. The
vocabulary service requires an explicit `KnowledgeStore`, and it rejects the
resolved path to FRIDAY's default production memory for teaching, lookup,
export, inspection, composition, and reset. Callers must select the isolated
store they intend to reset.

The supplied composition rule accepts exactly three normalized tokens with
roles `entity / predicate / entity` and returns the corresponding
subject/predicate/object concept IDs. It reads the stored semantic roles and
associations; it does not inspect or memorize the example-usage strings.
This is rule application, not grammar acquisition, rule induction, or
world-knowledge inference.

The existing FRIDAY adapter can also consume accepted `denotes` mappings to
core action/object labels when TransInfant is enabled. Regression tests verify
the `FRIDAY_TRANSINFANT=true` gate, explicit-action precedence, negation, and
that the interpretation path only returns NLU output; it does not execute an
external action.

## Dataset and leakage controls

The design/configuration is
[`experiment-003.json`](./experiment-003.json). Fixed, hand-authored,
versioned fixtures are
[`experiment-003-teaching.json`](./datasets/experiment-003-teaching.json) and
[`experiment-003-evaluation.json`](./datasets/experiment-003-evaluation.json).
The curriculum contains:

- 10 explicitly taught word associations and 10 symbol associations (`A`-`J`);
- 2 inferred, candidate-only associations for the ambiguous form `mep`;
- 22 teaching experiences total, representing 21 distinct input surfaces;
- five example-usage annotations, stored as metadata but never used as sentence
  lookup keys by the composer.

The evaluation splits contain 4 development, 4 validation, and 46 held-out
test cases. The held-out set has 4 symbol-recognition probes, 4 separate
symbol-to-concept probes, 4 word-to-concept probes, 4 previously shown usage
strings, 20 novel combinations of known words, 4 unknown-word probes, 2
ambiguity probes, and 4 unsupported role-sequence probes. Novel combinations
are not among the teaching example-usage strings. Test inputs and expected
outputs remain in the evaluation fixture; the runner calls the teaching API
only for the separate teaching fixture. No test utterance or expected frame is
embedded in the learner or composer.

## Conditions and metrics

- **A — empty:** clean isolated store, no associations, no composition.
- **B — association retrieval:** the 22 same teaching experiences as C; exact
  lookup enabled, composition disabled.
- **C — supplied-rule composition:** same 22 experiences as B plus the
  predeclared three-token role rule.

A is intentionally untrained; only B versus C is matched on taught facts.
Each condition has its own temporary store. The runner saves a versioned
snapshot of C's trained store as
[`memory-snapshot-003.json`](./memory-snapshot-003.json).

Metric denominators are the relevant test examples: symbol recognition is
scored separately from symbol mapping; word retrieval is exact concept-ID
accuracy; seen and unseen composition require exact output slot IDs and a
supported status; unknown rejection requires `unknown`; ambiguity handling
requires an `ambiguous` abstention; unsupported-inference rate counts
`supported` outputs on the four role-unsupported cases. Per-category counts
and confusion records are included in
[`results-003.json`](./results-003.json). Latencies are descriptive nearest-rank
p50/p95 wall-clock timings, with five repetitions per timed example; disabled
composition calls in A/B are excluded rather than counted as near-zero
latencies.

## Reproduction and audit

Run these from the project root:

```powershell
npm run typecheck
npm test
npm run build
npm run benchmark:transinfant:003
```

The runner writes `results-003.json`, `memory-snapshot-003.json`, and JSON to
stdout. It creates temporary isolated stores, starts a separate Node.js
process to reload and query C's store, and removes the temporary directory on
completion. No random sampling is used.

Before implementation, the existing project passed:

```text
npm run typecheck  -> exit 0; tsc --noEmit
npm test           -> 23 tests, 23 passed, 0 failed
npm run build      -> exit 0; tsc
```

The E002 benchmark was not rerun during this task: its already captured run was
dated `2026-10-16T06:53:46.224Z`, shortly before this audit, and its runner
overwrites `results-002.json`. The captured artifact reports A 3/12, B 7/12,
and C 12/12 exact frames. This avoids replacing the prior measured artifact.
Experiment 001 and Experiment 002 files were SHA-256 checked before and after
the work. The preserved hashes are:

| Artifact | SHA-256 |
|---|---|
| E001 `experiment-001/benchmark.ts` | `A589D3929B9945CB9B70BEE42A9BED1C26987DCCF6AE5557572497F000D3E030` |
| E001 `experiment-001/results.json` | `8C3924D0314ABBB14F335203326934EA645D87BFBFC2F6210AB57DD78279DCB9` |
| E001 `experiment-001/RESEARCH.md` | `C8D389A99BB2C172D8FBD23C9D4E025BD6BAFD64EF1D7041F82893C215999505` |
| E002 `benchmark-002.ts` | `6000CB4CF2B0D33BC389FA76C7CED0780DED6FFEE22E702D6E37D732C7F52569` |
| E002 `results-002.json` | `FB375194D10A26EF039BD03352EA166CC29E887BEE1BC6FACF5F10B9DD613F3E` |
| E002 `EXPERIMENT-002.md` | `79CB752B993B5CB3BE2FC169499DEFF9079D3B5F0E871C132BDB9C6B31DDF54C` |
| E002 `datasets/experiment-002.json` | `F4701EF954FCE36B35AA234F22834390AD10FDD3E431683E94FC9566ED78514F` |

## Results

Captured run: `2026-10-16T07:44:58.932Z`, Node.js `v24.13.0`, Windows x64.
Exact per-example predictions, training events, category counts, confusion
records, timings, and integrity checks are in
[`results-003.json`](./results-003.json).

| Condition | Accepted / candidate facts | Development | Validation | Held-out exact | Memory |
|---|---:|---:|---:|---:|---:|
| A — empty | 0 / 0 | 1/4 (25%) | 0/4 (0%) | 4/46 (8.7%) | 0 bytes |
| B — lookup only | 20 / 2 | 3/4 (75%) | 2/4 (50%) | 17/46 (37.0%) | 30,625 bytes |
| C — supplied rule | 20 / 2 | 4/4 (100%) | 4/4 (100%) | 46/46 (100%) | 30,625 bytes |

Held-out category results:

| Category | A | B | C |
|---|---:|---:|---:|
| Symbol recognition | 0/4 | 4/4 | 4/4 |
| Symbol-to-concept retrieval | 0/4 | 4/4 | 4/4 |
| Word-to-concept retrieval | 0/4 | 4/4 | 4/4 |
| Previously shown usage | 0/4 | 0/4 | 4/4 |
| Novel known-word combinations | 0/20 | 0/20 | 20/20 |
| Unknown-word rejection | 4/4 | 4/4 | 4/4 |
| Ambiguity handling | 0/2 | 1/2 | 2/2 |
| Unsupported role sequences | 0/4 | 0/4 | 4/4 |

The 20 novel compositions were formed from taught words but were not supplied
as teaching usage examples. C applied the supplied rule to all 20. This tests
the provided role-composition mechanism; it does not show that the system
learned the rule. B's composition cases are `disabled` by condition design,
not incorrect retrievals; its one successful ambiguity case is the direct
`mep` lookup, while composition is disabled.

All three conditions rejected all four unknown words. C returned `ambiguous`
for both ambiguity probes and made no supported assertion on any of the four
role-unsupported sequences (unsupported-inference rate **0/4**). These
role checks test only the supplied syntactic/semantic-role constraints; the
experiment does not test common-sense plausibility.

### Persistence, correction, and integrity

- A separate Node.js process reopened C's persisted JSON store and returned
  the expected word mapping, symbol mapping, and novel composition.
- Resetting a separate isolated store changed both a previously supported
  word and symbol query to unrecognized/unknown; the reset store contained
  zero relationships.
- A contradictory explicit mapping was rejected. Feedback changed symbol
  `C` from `meaning.apple` to `meaning.dog`; the unrelated word `cat` and
  symbol `B` remained unchanged. Reverting the correction restored
  `meaning.apple`. The relationship revision history is in the raw results.
- Re-teaching the same accepted word association reused its relationship;
  relationship count remained 22 before and after duplicate teaching.
- Snapshot JSON export succeeded. A corrupted store caused an explicit read
  failure and its original bytes remained unchanged.
- A direct reset request against FRIDAY's default store was rejected before
  touching it.
- All seven automated persistence/integrity checks passed.

### Timing

| Condition | Timed examples | Observations | P50 | P95 |
|---|---:|---:|---:|---:|
| A | 17 | 85 | 0.0764 ms | 0.1819 ms |
| B | 17 | 85 | 1.2406 ms | 1.9243 ms |
| C | 46 | 230 | 1.1005 ms | 1.6211 ms |

These are single-run, local measurements with different active task mixes
(A/B do not time disabled composition). They are descriptive only and do not
support a latency or significance claim.

## Limitations and error analysis

A's exact score reflects an empty memory: it correctly rejects unknown words
but cannot recognize the taught symbols or retrieve meanings. B retrieves all
tested known symbols and words but does not compose; its held-out errors are
the expected disabled-composition cases. C had no held-out errors on this
small fixture. That perfect result is likely fragile and should not be
generalized.

The symbols are exact text labels, not visual perception. Word meanings and
roles are explicitly supplied; definitions are stored as metadata, not
induced. Example usages are not used as complete-answer lookup, but four are
known controls. The composition rule is hand-specified; no grammar pattern is
learned. Role compatibility is deliberately simple. The data are synthetic
and hand authored, the test categories are small, and A does not receive the
same supplied associations as B/C. No statistical significance is claimed.
There is no generative LLM or external service.

## Final validation and next milestone

Final validation:

```text
npm run typecheck                 -> exit 0; tsc --noEmit
npm test                          -> 32 tests, 32 passed, 0 failed
npm run build                     -> exit 0; tsc
npm run benchmark:transinfant:003 -> exit 0; C 46/46, 7/7 integrity checks
```

The final suite includes the existing tests plus nine new vocabulary/FRIDAY
regressions. An initial
development test assertion and the first runner attempt failed while
implementation was in progress; both were fixed and the final validation
passed.

Reproduction commands are listed above. The recommended next milestone is
**grammar-pattern acquisition and controlled compositional generalization**:
provide examples without the target rule, pre-register a new held-out set,
compare learned patterns against the supplied-rule control, and keep
memorization, rule application, and genuine rule acquisition separately
scored.
