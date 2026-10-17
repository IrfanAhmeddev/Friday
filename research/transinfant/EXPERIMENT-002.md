# TIDA Experiment 002: controlled evaluation

## Research questions and falsifiable hypotheses

**RQ1:** Does one-relation retrieval improve action/object interpretation over
original FRIDAY on the predeclared examples?

**RQ2:** Does allowing separate accepted relations to fill both action and
object slots improve held-out known-concept compositions over one-relation
retrieval?

**RQ3:** Do negation checks, explicit-action precedence, conservative conflict
handling, and reversible feedback preserve abstention and correction behavior?

Falsifiable predictions: B will outperform A on examples where a supplied
single relation fills a missing frame slot; C will outperform B when both
action and object must be supplied by different relations. Both predictions
are limited to the fixed synthetic dataset and do not imply broad language
generalization.

## Version and environment

- Experiment: `TIDA-002`
- Dataset: `friday-transinfant-tida-002-v1`
- Benchmark: `friday-transinfant-controlled-eval-002-v1`
- Runtime observed during audit: Node.js v24.13.0
- TypeScript; local JSON store; no generative model/API
- Existing optional embedding pipeline remains unchanged and may download
  `Xenova/all-MiniLM-L6-v2` on first use.

Reproduction:

```powershell
npm run typecheck
npm run build
npm test
npm run benchmark:transinfant:002
```

The benchmark creates isolated temporary stores, removes them after completion,
and writes machine-readable JSON to `results-002.json` and stdout. The final
captured output is [`results-002.json`](./results-002.json). Experiment 001's
original benchmark, results, and research note are preserved under
[`experiment-001/`](./experiment-001/).

## Dataset and leakage controls

The predeclared JSON fixture is
[`datasets/experiment-002.json`](./datasets/experiment-002.json). It has 8
concept records and 4 explicit typed relationships in training, 4 development
utterances, 4 validation utterances, and 12 held-out test utterances. These are
small synthetic hand-authored records, not sampled user language.

The training curriculum contains concepts and relations but no evaluation
utterances. The benchmark initializes isolated stores for each condition;
only B and C learn the exact same four training relations. No evaluation item
or expected output is learned. Development and validation are reported but are
not used to tune the implementation in this run. The test split includes
known-concept combinations, multiword aliases, explicit precedence, negation,
unfamiliar aliases/concepts, a baseline control, and an intentionally repeated
input.

Condition A cannot receive injected relation facts through the existing
baseline classifier. Adding that ability would cease to be the unchanged
original baseline. A therefore has no trained facts; B and C have the same
facts. The B-versus-C comparison is the controlled comparison for the effect
of combining relation evidence. A-versus-B/C is an informative but
unequal-information comparison and must not be interpreted as an isolated
learning effect.

## Conditions

- **A — original FRIDAY:** existing `understand()` pipeline; TransInfant
  disabled; clean memory not read; no curriculum facts provided.
- **B — relation retrieval:** same pipeline and learned memory as C; adapter
  may use only the first supported direct relation candidate per utterance.
  It cannot combine separate action and object relations.
- **C — compositional adapter:** same pipeline and exact same learned memory as
  B; accepted relations may fill both missing fields. Explicit baseline actions
  and explicit negation remain authoritative.

Each condition uses its own clean temporary memory. B and C are initialized by
the same `learnExperience` call from the versioned curriculum. The test split
is rerun after store reload in a separate Node process and after a store reset.

## Metrics

- **Exact action/object accuracy:** both output fields match the expected frame
  divided by samples.
- **Per-category accuracy:** exact-frame accuracy by the predeclared dataset
  category.
- **Confusion counts:** predicted frame counts within each expected frame.
- **Unsupported interpretation rate:** predicted non-`unknown` fields divided
  by fields whose expected value is `unknown`.
- **Correct abstention rate:** all-`unknown` predictions divided by examples
  whose expected action and object are both `unknown`.
- **Correction retention:** feedback replaces a conflicting functional
  relation; an explicitly rejected conflict does not replace it; reverting
  the correction restores the prior accepted relation.
- **Duplicate handling:** duplicate facts reuse the existing relationship ID
  and do not increase relation count.
- **Persistence:** exact test outputs after a separate process reload are
  compared with the same-process C run.
- **Reset:** re-run the held-out set against a clean store and report scores.
- **Latency:** full `understand()` warm latency, five timed repetitions per
  held-out item, p50 and nearest-rank p95. This sample size is descriptive.

## Results

Captured from `npm run benchmark:transinfant:002`, run on 2026-10-16 with Node
v24.13.0 on Windows x64. Exact per-sample results, confusion counts, split
scores, learning events, and persistence results are in
[`results-002.json`](./results-002.json).

| Condition | Training facts available | Development | Validation | Held-out test exact frames | Unsupported fields | Correct all-unknown abstention |
|---|---:|---:|---:|---:|---:|---:|
| A: original FRIDAY | 0 | 0/4 (0%) | 3/4 (75%) | 3/12 (25%) | 0/6 | 2/2 (100%) |
| B: one-relation retrieval | 4 | 4/4 (100%) | 4/4 (100%) | 7/12 (58.3%) | 0/6 | 2/2 (100%) |
| C: compositional adapter | 4 | 4/4 (100%) | 4/4 (100%) | 12/12 (100%) | 0/6 | 2/2 (100%) |

B and C have equal access to the same four curriculum relations. The B-to-C
gain is 5 additional exact frames (7/12 to 12/12) on this fixed test set and is
consistent with the test's compositional cases. It is not a statistical
significance claim or a broad natural-language accuracy estimate. A receives no
facts because the unchanged baseline has no relation-ingestion path; the
A-to-B/C comparison is not an equal-information comparison.

### Test category accuracy

| Predeclared category | A | B | C |
|---|---:|---:|---:|
| Known composition control | 0/1 | 1/1 | 1/1 |
| Known-concept novel combination | 0/3 | 0/3 | 3/3 |
| Multiword alias composition | 0/1 | 0/1 | 1/1 |
| Explicit action precedence | 0/1 | 1/1 | 1/1 |
| Negation | 1/1 | 1/1 | 1/1 |
| Unfamiliar action alias, known object | 0/1 | 1/1 | 1/1 |
| Known action, unfamiliar concept | 0/1 | 1/1 | 1/1 |
| Unfamiliar concepts | 1/1 | 1/1 | 1/1 |
| Known core control | 1/1 | 1/1 | 1/1 |
| Repeated-input control | 0/1 | 0/1 | 1/1 |

The unfamiliar-action/known-object result is not a false positive: the expected
action is `unknown`, while the known object is supported by an accepted
`is-a` fact. All conditions correctly abstained on both fully unfamiliar
concepts. Across the six fields whose expected value was `unknown`, none of the
conditions emitted an unsupported non-unknown field.

### Error analysis

- A missed 9/12: it lacked the injected alias/category facts; it passed
  negation, the fully unfamiliar case, and the known core control.
- B missed 5/12: the single-relation policy correctly withheld combining the
  learned action alias and learned object category on the three novel
  combinations and repeated case. It also missed the multiword composition:
  the explicit `show` action relation was the single retrieved candidate, so
  it did not fill the object slot.
- C had no errors on these 12 records. This perfect score is expected to be
  fragile given the tiny, deliberately compositional test set.

### Stability and performance

The C store contained 5,117 bytes after learning and was reopened by a separate
Node process. The restarted process reproduced all 12 test frames exactly
(12/12). After resetting the store, the same test fell to 3/12 (25%), which
shows that most of C's scored gains depended on the removed facts in this
fixture.

An explicitly contradictory non-feedback relation was rejected (1/1); explicit
user feedback replaced the old fact (1/1); a repeated relation reused the
stored relationship rather than adding a duplicate; reverting the feedback
restored the original accepted fact. See the machine-readable event log for
individual outcomes.

Timing used 5 repetitions per each of 12 held-out samples (60 observations per
condition), after a warm-up. These numbers include the full NLU pipeline and,
for B/C, persisted store reads:

| Condition | P50 | P95 | Memory |
|---|---:|---:|---:|
| A | 0.714 ms | 2,956.932 ms | 0 bytes of learned memory |
| B | 18.216 ms | 2,979.250 ms | 5,117 bytes |
| C | 22.508 ms | 3,905.278 ms | 5,117 bytes |

The large P95 values and single-run timing protocol indicate substantial
latency variability. No service-level or statistical conclusion should be
drawn from them.

## Error analysis and limitations

Regardless of outcome, the dataset is small,
synthetic, and hand authored. Surface matching uses aliases that were explicitly
provided; this is not paraphrase learning or autonomous concept formation.
Condition A lacks access to trained facts, so only B/C isolate the integration
effect under matched fact access. No significance claims are planned.

## Audit and reproduction record

Before Experiment 002 changes, the existing project passed `npm run typecheck`,
`npm test` (22 tests, 22 passed), `npm run build`, and the original
`npm run benchmark:transinfant`. The original artifacts have been copied
byte-for-byte to `experiment-001/`; SHA-256 checks for the three archived
artifacts matched the then-current originals before this document was updated.
The audit run of Experiment 001's benchmark reported 2/8 baseline and 8/8
integrated exact frames, with 4,525 bytes of learned memory. Its latency values
were highly variable; see the preserved Experiment 001 output for exact values.

The Experiment 002 implementation then passed `npm run typecheck`, `npm test`
(23 tests, 23 passed), and `npm run build`. It completed
`npm run benchmark:transinfant:002` successfully; the captured JSON output from
that run was persisted to `results-002.json`. The runner now also writes future
results directly to that path. Re-run the reproduction commands above to
generate a new timestamped single-run result; that rerun will replace
`results-002.json`.
