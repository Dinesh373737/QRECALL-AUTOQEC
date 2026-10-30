# Decoder benchmark & failure-investigation report

Data: Google Quantum AI, *Suppressing quantum errors by scaling a surface code logical qubit*, Zenodo
10.5281/zenodo.6804040 (131 experiments). All numbers come from `results/google/baseline.json`,
`results/google/ising.json` and the Failure Investigator (`backend/hardware/explanations.find_shots`);
nothing here is extrapolated.

## Decoders compared

| Short | Decoder | Where it runs |
|---|---|---|
| Ising | Noise-aware Ising/QUBO, exact MLE (HiGHS MILP), held-out `pij` weights | this project |
| Ising-U | Same, all mechanisms weighted equally (ablation) | this project |
| PM-circ | PyMatching on the circuit DEM | this project |
| PM-pij | PyMatching on the held-out `pij` DEM (even↔odd partition) | this project |
| PM-corr | PyMatching correlated matching on the `pij` DEM | this project |
| G-PM / G-corr / G-BM / G-TN | Google's PyMatching, correlated matching, belief matching, tensor network | predictions shipped in the archive |

## How the comparison is made

* **Identical shots.** In every Ising experiment all nine decoders are scored on the same first
  N shots (5,000 at d=3, 2,000 at d=5).
* **Paired test.** Exact McNemar on the discordant shots; “better” below means p < 0.05. Everything else
  is reported as *unresolved*, not as a win.
* **Held-out weights.** `pij`-based decoders decode odd shots with weights fitted on even shots and vice versa.
* **Time-limited solves.** A shot whose MILP hits the 10 s limit keeps the best solution found so far
  (not proven optimal). This only happened at d=5, r=5: 78 of 2,000 shots (X) and 119 of 2,000 (Z), so the
  Ising numbers there are a pessimistic bound on exact MLE.

## 1. Overall result (all 30 surface-code experiments with 1, 3 or 5 rounds; 132,000 shots, identical for every decoder)

| Decoder | G-TN | **Ising** | G-BM | PM-corr | G-corr | PM-pij | PM-circ = G-PM | Ising-U |
|---|---|---|---|---|---|---|---|---|
| Logical failure | **7.06%** | **7.25%** | 7.37% | 7.71% | 8.00% | 8.41% | 8.66% | 9.37% |

The ranking is the same in the X basis (7.16 / 7.27 / 7.42 / 7.75 %) and the Z basis
(6.97 / 7.23 / 7.31 / 7.67 %). Z memory is slightly easier for every decoder.

### Paired verdicts: Ising vs each decoder (30 experiments)

| Opponent | Ising significantly better | Unresolved | Ising significantly worse |
|---|---|---|---|
| PM-circuit / G-PM | 20 | 10 | 0 |
| PM-pij | 19 | 11 | 0 |
| G-correlated | 15 | 15 | 0 |
| PM-correlated | 10 | 20 | 0 |
| G-belief matching | 1 | 28 | 1 |
| G-tensor network | 0 | 23 | **7** |
| Ising-uniform (ablation) | 26 | 4 | 0 |

The Ising decoder is never significantly worse than any matching decoder. It ties belief matching in 28
experiments (beats it in one, loses in one), and is significantly worse than Google's tensor network in 7.
Calibrated weights matter: the uniform-weight version is worse in 26 of 30 experiments and never better.

## 2. Which decoder is better in which case

### By number of rounds

| Rounds | Ising, pooled | Result |
|---|---|---|
| **1** (10 exps) | 1.55% | **Every decoder ties.** All 10 experiments are unresolved against every decoder; the spread is ≤ 0.1 pp. With one round there is almost no time-like structure to exploit, so the cheapest decoder (PyMatching) is the right choice. |
| **3** (10 exps) | 7.43% (TN 7.18, BM 7.59, PM-corr 7.89, PM-pij 8.61) | Ising beats PM-pij in **10/10** and PM-corr in 3/10. It ties belief matching 10/10 and loses to TN in 3/10. |
| **5** (10 exps) | 12.77% (TN 12.50, BM 12.95, PM-corr 13.69, PM-pij 15.06) | At d=3 this is where the Ising decoder helps most: it beats PM-pij **8/8** and PM-corr **7/8**, and beats belief matching once (d3 X r5 (5,7): 11.84% vs 12.98%). It loses to TN in 4/10. At d=5 r5 the solver time limit bites (see below). |
| 7–25 (surface, 96 exps) | not run (exact MILP too slow) | **G-TN has the lowest rate in all 96**, followed by G-BM, then PM-corr ≈ G-corr, then PM-pij, then PM-circ. Example at d=5: r7–13 TN 20.2%, BM 21.1%, PM-corr 23.0%, PM-circ 27.1%. |

### By distance

| Distance | Ranking (pooled, identical shots) | Notes |
|---|---|---|
| d=3 (24 exps, 120k shots) | TN 7.20 < **Ising 7.34** < BM 7.50 < PM-corr 7.84 < G-corr 8.12 < PM-pij 8.50 < PM-circ 8.77 | The Ising decoder is second, and the gap to TN (0.14 pp) is within the paired uncertainty in 19 of 24 experiments. |
| d=5 (6 exps, 12k shots) | TN 5.68 < BM 6.03 < **Ising 6.35** < PM-corr 6.42 < G-corr 6.78 < PM-pij 7.43 < PM-circ 7.56 | At d5 r5 the Ising decoder (X 12.80%, Z 11.70%) is level with PM-corr (12.40%, 11.20%), and BM/TN are better (Z: 10.30% / 10.35%, both significant). 78 and 119 shots there hit the 10 s solver limit, so exact MLE at d5 r5 needs a longer time limit to be judged fairly. |
| d=25 repetition code (1 exp, 500k shots) | PM-circ = G-PM 0.0068% ≈ G-corr ≈ PM-pij ≈ PM-corr 0.008% | All tie; the code suppresses errors so strongly that the decoders hardly differ. |

### Experiments where the Ising decoder had the lowest failure count

d3 X r5 at patch (3,5), (5,7), (7,5) and d3 Z r3 at (7,5), plus three ties at r=1. G-TN was lowest in
21 experiments and G-BM in d5 Z r5. None of the Ising wins over TN is significant.

### Experiments where G-TN was significantly better than Ising

d3 X r3 (7,5); d3 Z r3 (3,5), (5,7); d3 Z r5 (5,7), (7,5); d5 X r5; d5 Z r5. Six of the seven are
Z-basis or d5 experiments, which is where hyperedge/correlated faults matter most and the tensor network's
summation over *all* error configurations pays off. Exact MLE picks the single most likely
configuration.

## 3. Failure investigation (all 30 experiments, 132,000 shots)

### Failure rate by syndrome weight (number of detection events in the shot)

| d=3, events | Shots | Ising | PM-pij | PM-corr | G-corr | G-BM | G-TN |
|---|---|---|---|---|---|---|---|
| 0 | 36,100 | 0.01 | 0.01 | 0.01 | 0.01 | 0.01 | 0.01 |
| 1–2 | 30,795 | 3.05 | 3.10 | 3.10 | 3.16 | 3.15 | **3.03** |
| 3–5 | 31,655 | 9.97 | 11.44 | 10.47 | 10.83 | 10.11 | **9.83** |
| 6–8 | 15,388 | 19.01 | 23.20 | 20.74 | 21.81 | 19.62 | **18.54** |
| 9–12 | 5,383 | 28.39 | 32.86 | 30.97 | 31.62 | 28.85 | **27.90** |
| ≥ 13 | 679 | 37.26 | 42.12 | 40.21 | 41.53 | 37.11 | **35.35** |

| d=5, events | Shots | Ising | PM-pij | PM-corr | G-corr | G-BM | G-TN |
|---|---|---|---|---|---|---|---|
| 3–5 | 1,573 | 1.21 | 1.53 | 1.40 | 1.46 | 1.40 | **1.02** |
| 6–8 | 1,373 | 2.84 | 3.28 | 2.99 | 2.99 | **2.62** | 2.77 |
| 9–12 | 1,967 | 5.90 | 6.86 | 5.95 | 6.81 | 5.64 | **5.08** |
| ≥ 13 | 3,947 | 14.77 | 17.30 | 14.85 | 15.45 | 13.91 | **13.25** |

**Reading:** with 0–2 detection events every decoder makes the same decision. The advantage of
exact/approximate-inference decoders over matching grows with syndrome weight: at d=3 with 6–8 events,
Ising fails 19.0% vs 23.2% for PyMatching (pij), roughly 4 pp better. Busy syndromes are where the
graph-matching approximations (no hyperedges, no Y correlations in plain matching) break down.

### Complementary gap as a confidence signal

The gap is E(best solution with the opposite observable) − E(best solution), in nats.

| Ising gap | Shots | Ising | PM-pij | PM-corr | G-BM | G-TN |
|---|---|---|---|---|---|---|
| < 1 | 8,674 | 42.2% | 44.1% | 43.3% | 42.6% | 39.9% |
| 1–3 | 17,566 | 20.8% | 25.9% | 23.0% | 21.6% | 20.7% |
| 3–6 | 39,121 | 5.1% | 6.2% | 5.4% | 5.1% | 5.1% |
| ≥ 6 | 63,856 | 0.13% | 0.17% | 0.13% | 0.13% | 0.13% |

The gap predicts failure for **every** decoder, not just for Ising: a small gap means two explanations of
the syndrome are nearly as likely, and nobody can reliably tell them apart. On held-out shots its AUROC is
0.754 to 0.981 (median 0.88; the lowest is d5 Z r5, where solves hit the time limit). The 1–3 nat band is where a good decoder matters: Ising and TN are about
5 pp better than PyMatching (pij) there.

### Shots only one decoder got right / wrong

| Decoder | Only one correct | Only one wrong |
|---|---|---|
| G-TN | 260 | 236 |
| G-correlated | 230 | **512** |
| PM-correlated | 207 | 464 |
| **Ising** | 175 | 325 |
| PM-pij | 99 | 364 |
| G-BM | 58 | **123** |

(PM-circuit and G-PM make identical predictions, so neither can be the only one.)

* **5,536 shots (4.2%) defeat every decoder.** They average 6.0 detection events against 3.4 overall:
  heavy, ambiguous syndromes that no decoder can fix.
* **1,362 shots are fixed only by Ising** compared with the three PyMatching configurations.
* **2,059 shots are confident Ising failures** (gap > 3 nats yet wrong). Here the hardware did
  something the calibrated model considers unlikely, which points to model mismatch (e.g. leakage or
  bursts) rather than to a decoding error.
* Belief matching is the most consensus-safe decoder: it is rarely the only one wrong (121) and also
  rarely the only one right (55).

## 4. Speed

| Decoder | d=3 | d=5 |
|---|---|---|
| PM-circ / PM-pij (median per shot) | ≈ 10–12 µs | ≈ 60 µs |
| PM-corr | ≈ 32 µs | ≈ 160 µs |
| Ising exact MILP (median per shot) | 15–27 ms | 54 ms (r3), 0.7–0.9 s (r5) |

The exact Ising decoder is about 1,000–10,000× slower than matching. It is a reference and offline
decoder, not a real-time one. The archive has no latency figures for Google's decoders, so the
Configuration Advisor cannot score their speed.

## 5. Recommendations by case

| Situation | Best choice | Why |
|---|---|---|
| 1 round, any distance | PyMatching (circuit or pij) | Every decoder ties; PyMatching is fastest. |
| d=3, 3–5 rounds, best accuracy, offline | Google TN, or **Ising noise-aware** if TN is unavailable | Ising is second overall, beats every matching configuration, ties belief matching. |
| d=5, 5 rounds | Google TN or belief matching | The exact MILP hits its time limit on 4–6% of shots here and drops to PM-correlated level. |
| d=5 or more than 5 rounds, best accuracy | Google TN, then belief matching | TN has the lowest rate in all 96 long-round experiments; Ising was not run there. |
| Any latency budget | PyMatching correlated | It is the most accurate decoder with µs latency (7.71% vs 8.41% pij on identical shots). |
| Lowest compute | PyMatching pij | It beats the circuit DEM in 88 of 131 experiments (1 worse) at almost the same cost. |
| Repetition code | Any matching decoder | All tie at ≈ 0.007%. |
| Flagging likely failures | Ising complementary gap | A gap below 1 nat means ≈ 40% failure for every decoder; ≥ 6 nats means ≈ 0.13%. |

**Configuration Advisor check:** with Google's tensor network excluded and reliability weighted high
(reliability 1, space 0.5, speed 0), the advisor recommends **Ising noise-aware** at 5 rounds
(d3 X (5,7), 11.84%); with TN included it picks TN (d3 Z (5,7), 11.22%). At 3 rounds it recommends Ising
even with TN included (d3 Z (7,5), 6.48%). Any
speed weight of 0.1 or more moves the recommendation to PyMatching (correlated or pij). The per-round
target mode never shows Ising, because Ising was only run up to 5 rounds.
