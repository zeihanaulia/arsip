# Improve Code Understandability

Use this skill when changed JavaScript or TypeScript triggers Biome's
`lint/complexity/noExcessiveCognitiveComplexity` (threshold 15), or when a
change introduces control flow that is hard to follow.

Objective: make the code easier to understand and safely modify.
Cognitive Complexity is a diagnostic signal — do not optimize the score
independently of understandability.

## 1. Understand behavior first

- Identify the function's responsibility, inputs, outputs, side effects, error behavior.
- Read existing tests covering it.
- Map branches, loops, exception handling, early exits; note which conditions are real domain decisions.

Do not refactor control flow you do not understand.

## 2. Locate the cognitive load

Determine whether it comes from deep nesting, nested loops, long
`if`/`else if` chains, tangled booleans, duplicated conditions, multiple
responsibilities, exception handling mixed with core logic, or state
mutations spread across branches. Separate essential domain complexity
from accidental implementation complexity.

## 3. Simplify locally before extracting

Prefer, when behavior stays clear: guard clauses / early returns, less
nesting, removed redundant conditions, simpler booleans, no duplicated
branching, lookup tables or `switch` where clearer, error paths separated
from the happy path. Do not apply mechanically if flow gets less clear.

## 4. Extract only cohesive abstractions

Extract when the operation is a meaningful concept with a precise name
that lets the caller be understood without opening the helper. Never
lower the score by scattering logic into `step1 → step2 → step3` chains
that still require reading everything. Watch for trading control-flow
complexity for navigation/indirection complexity.

## 5. Preserve locality

Code that changes together should stay understandable together. A modestly
complex but local implementation beats artificially fragmented code.

## 6. Validate

After each meaningful refactor: run Biome on affected files, run `tsc`,
run relevant tests, inspect the diff. Confirm behavior preserved, gate
passes, code reads easier, no duplicated logic, no rule disabled.

## 7. Escalate essential complexity

If lowering the score would worsen clarity, stop and explain why the
complexity is essential, which alternatives were considered, and why they
are worse. Do not suppress, raise the threshold, or touch Biome config
unless the task explicitly authorizes a policy change.
