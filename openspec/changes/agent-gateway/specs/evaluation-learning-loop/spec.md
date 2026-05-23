## ADDED Requirements

### Requirement: Evaluation suites and cases
The system SHALL define eval suites, eval cases, eval runs, metrics, results, regression cases, and quality gates for flows, steps, skills, artifacts, evidence, and policies.

#### Scenario: Run skill output eval
- **WHEN** a skill version is evaluated before publication
- **THEN** the system executes configured eval cases and records pass/fail results with metric details

### Requirement: MVP quality checks
The system SHALL support skill trigger evals, skill output schema evals, evidence/citation evals, artifact format evals, policy permission evals, and regression case extraction.

#### Scenario: Verify evidence coverage
- **WHEN** a Deep Research report is generated
- **THEN** the system evaluates citation coverage and records unsupported or weakly supported claims

### Requirement: Learning signal capture
The system SHALL capture learning signals from user corrections, verifier failures, provider failures, retries, cost outliers, failed-then-succeeded runs, and manual feedback.

#### Scenario: Capture verifier failure signal
- **WHEN** a verifier fails because source coverage is insufficient
- **THEN** the system records a learning signal linked to the run, step, verifier result, and evidence state

### Requirement: Reviewable improvement proposals
The system SHALL create reviewable proposals for memory updates, skill changes, policy suggestions, and new eval cases instead of automatically changing production behavior.

#### Scenario: Propose regression case
- **WHEN** a real run failure is corrected and completed
- **THEN** the learning loop creates an EvalCase proposal that can be reviewed before inclusion in a regression suite

### Requirement: Quality gate enforcement
The system SHALL prevent publishing or promoting skill versions that fail required eval or policy gates.

#### Scenario: Block skill publication
- **WHEN** a draft skill version fails required output schema or policy permission evals
- **THEN** the system keeps the skill in draft state and records the failed quality gate
