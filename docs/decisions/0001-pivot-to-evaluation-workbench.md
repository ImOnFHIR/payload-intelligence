# ADR 0001: Pivot from portfolio study to an evaluation workbench

SPDX-License-Identifier: Apache-2.0

Status: accepted on 2026-10-13.

The previous private P1/P2 experiment emphasized study consent, signed publication artifacts, and release lifecycle controls before the underlying experience was handoffable. Its frozen model also failed its small holdout and is not carried forward.

This repository instead provides a usable, model-neutral evaluation loop. Deterministic code observes a synthetic payload, the user approves a value-minimized structural summary, Codex or Claude submits closed-code hypotheses through MCP, and a healthcare interoperability SME corrects and exports the result.

The historical evidence repository remains frozen at commit `aaad9de`. Its study machinery, model artifacts, and publication claims are neither imported nor treated as product evidence here.
