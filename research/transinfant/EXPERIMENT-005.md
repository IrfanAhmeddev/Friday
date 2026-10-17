# TIDA Experiment 005: incremental learning and compositional transfer

## Status and research question

This experiment evaluates incremental vocabulary updates, weakly supervised
pattern refinement, corrections, retention, transfer, and persistence on a
small synthetic curriculum. It does not establish general continual learning,
human-like development, or broad language understanding.

**RQ:** Can TransInfant add vocabulary and structural evidence in stages,
combine items taught in different phases on held-out combinations, preserve
earlier associations, and recover from corrections and restart?

Hypotheses:

- **H1:** Adding vocabulary in Phase B will preserve Phase A associations.
- **H2:** A pattern induced from Phase A and refined with Phase C examples will
  compose vocabulary learned in separate phases.
- **H3:** Pattern-based composition will outperform exact-example retrieval on
  the final held-out combinations.
- **H4:** Feedback correction will replace a wrong mapping without damaging
  unrelated vocabulary, and reversal will restore the immediately prior state.
- **H5:** Earlier vocabulary and task performance will survive unrelated
  Phase F teaching.
- **H6:** Knowledge state, pattern provenance, and output will survive a
  separate-process reload.
- **H7:** Teaching order may affect intermediate performance even if the final
  cumulative state converges.

## Architecture and protocol

The experiment reuses the existing JSON-backed `KnowledgeStore`,
`teachVocabulary`, `queryVocabulary`, `revertExperience`, and the new bounded
pattern inducer. Vocabulary facts and patterns are stored independently in
isolated temporary paths. Phase checkpoints are exported to
[`checkpoints-005/`](./checkpoints-005/), including a separately labeled
`phase-g-reset.json` snapshot after the isolated stores are reset. No
production memory is reset or written.

The inducer enumerates six role-position permutations for exactly three
tokens. It receives weakly supervised frames, not a supplied SVO order.
Two distinct consistent examples are required for acceptance; contradicted
evidence rejects the candidate. The curriculum intentionally distinguishes
pattern induction from exact-example retrieval and from the direct-rule
reference in Experiment 004.

Conditions:

- **A — empty:** fresh vocabulary and pattern stores.
- **B — retrieval:** exact stored training-example lookup only.
- **C — incremental vocabulary:** the existing TransInfant learning and
  retrieval path without pattern composition.
- **D — induced composition:** the same staged vocabulary and examples as C,
  plus the induced/refined pattern.
- **E — correction control:** the same facts and pattern in separate stores,
  compared with a wrong association followed by explicit feedback and
  reversible updates.

The retrieval and composition conditions have access to the same teaching
examples and word associations. A is an unequal-information baseline. The
no-correction store receives the same valid curriculum facts but no deliberate
wrong update or correction.

## Dataset and split versioning

Final dataset version: `tida-005-incremental-curriculum-v2`.

| Phase/split | Size | Contents |
|---|---:|---|
| Phase A vocabulary | 6 associations | Initial people, action, and object words |
| Phase A examples | 2 labeled examples | Initial weakly supervised structure |
| Phase B vocabulary | 2 new associations | New subject word and action word |
| Phase C examples | 2 labeled examples | Additional structure for pattern refinement |
| Phase probes | 6 total | Two each after A, B, and C |
| Final held-out test | 4 examples | Novel combinations absent from all teaching and phase probes |
| Phase F unrelated vocabulary | 8 associations | Interference/retention test |
| Teaching orders | 2 | A→B and B→A |

The initial fixture [`experiment-005-heldout.json`](./datasets/experiment-005-heldout.json)
is retained as v1 but **superseded**. Review found it overlapped some Phase B/C
probe strings. It is not used in the final result. The independent final set is
[`experiment-005-heldout-v2.json`](./datasets/experiment-005-heldout-v2.json).
All final held-out strings are absent from Phase A/B/C teaching, the Phase D
correction example, and all six phase probes. The test words are known, but
their combinations are withheld.

The curriculum is fixed and hand authored; no random sampling occurs. The
final dataset hashes are in [`results-005.json`](./results-005.json):

- Curriculum: `815208925aba6210eb2940a9e6dce280336afdba83d541a19f2cab93ee1886a1`
- Held-out v2: `890baf763b155e3d80606e81493a3b7676c646fadf59174b24cc0d033fe11773`

## Phase-by-phase results

Reproduced `2026-10-17T10:47:16.842Z`, Node.js `v24.13.0`, Windows x64.
Results for the two fixed schedules:

| Measure | A→B→C… | B→A→C… |
|---|---:|---:|
| Phase A vocabulary acquisition | 6/6 | 6/6 |
| Phase A held-out probes | 2/2 | 2/2 |
| Phase B new vocabulary acquisition | 2/2 | 2/2 |
| Phase A retention after both vocabulary batches | 6/6 | 6/6 |
| Phase B held-out probes at that phase | 2/2 | 0/2 |
| Phase C held-out probes | 2/2 | 2/2 |
| Final cross-phase held-out composition | 4/4 | 4/4 |
| Exact example retrieval on final held-out | 0/4 | 0/4 |
| No-correction control final composition | 4/4 | 4/4 |
| Vocabulary exact mapping after Phase F | 8/8 | 8/8 |
| False vocabulary associations after Phase F | 0/8 | 0/8 |
| Old-task forgetting after Phase F | 0.00 accuracy points | 0.00 accuracy points |
| Separate-process output retention | 4/4 | 4/4 |
| Integrity checks | 7/7 | 7/7 |

The Phase B order effect is expected from the information sequence. In B→A,
the new two words are recognized (2/2), but the grammar pattern has not yet
been induced, so the Phase B structural probes score 0/2. After Phase A
examples arrive, Phase A and C probes score 2/2 and the final state converges
to the same 4/4 held-out result as A→B. This demonstrates an intermediate
dependency on the pattern evidence, not a general order-invariant learning
claim.

Phase C supplied two additional labeled examples; the accepted revised
pattern remained `subject / predicate / object`. A deliberately contradictory
frame set was rejected. The corrected evidence set produced version 4; writing
the pre-Phase-C version back restored its prior interpretation (revision
revert passed).

### Correction, contradiction, and reversion

The learner first rejected one non-feedback contradictory mapping (1/1).
The controlled deliberately wrong feedback mapping was then accepted, followed
by a corrective feedback mapping to `person.tavi` (1/1 correction success).
The unrelated `mira` mapping remained unchanged. Reverting the correction
restored the deliberate wrong mapping; reverting that update restored the
original `person.tavi` mapping. Event IDs and outcomes are preserved in the
results/checkpoint files. The separate no-correction control retained the
original mapping and scored 4/4 on the final held-out set.

### Retention, storage, latency, and restart

After eight unrelated Phase F associations, exact old vocabulary retrieval
remained 8/8, the final held-out score remained 4/4, and measured forgetting
was zero absolute accuracy points. UTF-8 JSON store sizes for A→B were:

| Point | Vocabulary store | Pattern store |
|---|---:|---:|
| After Phase A | 9,425 bytes | 2,043 bytes |
| After Phase B | 12,523 bytes | 2,043 bytes |
| After Phase C | 12,523 bytes | 2,755 bytes |
| After Phase D correction and reversion events | 15,364 bytes | 2,755 bytes |
| After Phase F unrelated learning | 27,724 bytes | 2,755 bytes |

The B→A partial Phase B state had a 3,205-byte vocabulary file and no pattern
file; after Phase A, its state converged to the same later sizes.

For each teaching order, inference timing used 20 observations (five
repetitions per each of four final test items). A→B p50/p95 was 3.2323/5.2154
ms; B→A was 2.2066/3.8098 ms in this run. These are descriptive single-run
measurements and vary with local file I/O.

A separate Node process reloaded the final knowledge and pattern files. It
reproduced all four frames, concept/symbol/relationship/event counts matched,
and pattern version and evidence provenance matched. Reset of the isolated
stores removed the `mira` association (query became `unknown`) and pattern;
both production-store path guards passed. The runner did not modify FRIDAY's
production memory.

## Metrics, failures, and limitations

- **Vocabulary acquisition/retention:** exact concept-ID match divided by
  vocabulary items tested.
- **Probe/transfer accuracy:** exact three-slot concept-ID frame divided by
  phase probes or final held-out examples.
- **Retrieval baseline:** only exact stored teaching sentences can return a
  frame.
- **False association rate:** supported but incorrect concept IDs divided by
  tested vocabulary items; measured 0/8 after Phase F.
- **Forgetting:** `max(0, pre-interference accuracy - post-interference
  accuracy)` in absolute accuracy points.
- **Correction/reversion:** exact mapping state checks before/after feedback
  and each explicit revert.
- **Restart retention:** exact frames, persisted counts, and evidence IDs after
  a fresh process.
- **Memory growth:** bytes in the isolated JSON stores at each captured phase.

No evaluation errors occurred in the final runner; no operation timed out.
The harness does not enforce per-operation timeouts. The curriculum is small,
synthetic, role-labeled, and uses a single fixed-length construction. It does
not evaluate broad vocabulary, natural language, capacity pressure, eviction,
or multi-user/concurrent process writes. The two sequence orders are fixed
deterministic cases, not a statistical sample.

## FRIDAY/JARVIS integration compatibility

Experiment 004 provides an opt-in `UnderstandOptions.grammarPatternStore`
adapter and adds diagnostics under `context.transinfant.grammarPattern` only
when that optional store is supplied. Legacy NLU semantic/intent fields,
routes, and request fields remain unchanged. `/api/understand` also includes
the additive `intelligence` contract v1 projection. `FRIDAY_TRANSINFANT=true`
remains the opt-in gate. Pattern output is evidence-bearing structured
interpretation only; no learned pattern authorizes tools or external actions.
No Android or JARVIS execution code was changed.

For a later JARVIS upgrade, the diagnostic exposes frame IDs, recognized
concepts, pattern version/source, supporting evidence, vocabulary relation
provenance, confidence, and abstention reason. The consumer must independently
validate permissions, resolve ambiguity, and require confirmation for
consequential actions.

## Validation and reproduction

Pre-change baseline:

```text
npm run typecheck  -> exit 0
npm test           -> 32 tests, 32 passed, 0 failed
npm run build      -> exit 0
```

Final validation:

```text
npm run typecheck                 -> exit 0
npm test                          -> 49 tests, 49 passed, 0 failed
npm run build                     -> exit 0
npm run test:model-smoke          -> exit 0; MiniLM emitted a 384-dimensional vector
npm run benchmark:transinfant:005 -> exit 0; both schedules and integrity checks passed
```

The first E005 fixture was superseded for split overlap before the final v2
evaluation. An initial B→A run also exposed the absent pattern-file case in the
memory-size recorder; the runner now reports that size as zero. These
intermediate runs are not the reported final result. The project directory is
not a Git repository, so no code revision hash is available.

Reproduce from the project root:

```powershell
npm run typecheck
npm test
npm run build
npm run benchmark:transinfant:004
npm run benchmark:transinfant:005
```

The benchmark writes `results-005.json` and phase snapshots under
[`checkpoints-005/`](./checkpoints-005/); runtime stores are created in isolated
temporary directories and removed after each sequence.

## Conclusion and next milestone

For this curriculum, facts taught in different phases were combined on four
novel combinations; exact retrieval alone returned none. Earlier mappings
survived the small unrelated learning batch and persisted through restart.
The B-first intermediate probe failure also shows that vocabulary acquisition
alone did not provide structural interpretation until pattern evidence
arrived. These results support only the narrow implementation claims above.

Next, test multiple patterns and variable constructions using less role
supervision, a larger predeclared held-out set, and capacity/interference
stress. Retain a grounded unlabeled condition; do not relabel supplied or
weakly supervised rules as unsupervised learning.
