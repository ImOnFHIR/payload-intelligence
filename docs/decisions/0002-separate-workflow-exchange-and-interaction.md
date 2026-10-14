# ADR 0002: Separate workflow, exchange shape, and interaction kind

SPDX-License-Identifier: Apache-2.0

Status: accepted on 2026-10-14.

The v1 evaluator asked a host for `workflow` and `direction`. Those labels mixed
different concepts. A FHIR Bundle can be a resource collection without revealing
the business workflow, and a message can represent an event without establishing
a request/response direction. Combining those dimensions made an exact-match
record look more precise than the structural evidence justified.

Taxonomy v2 replaces them with distinct axes:

- `businessWorkflow` describes the healthcare or administrative purpose.
- `exchangePattern` describes the structural exchange shape.
- `interactionKind` describes request, response, or event semantics.
- `sourceActorRoles` and `destinationActorRoles` are reviewed independently.

Format remains a deterministic observation and is not a host hypothesis. Unknown
or inapplicable conclusions remain explicit controlled values. Missing-context
questions, conflicts, and next actions are axis-specific.

Existing v1 browser records remain byte-for-byte legacy artifacts. They are never
silently mapped into v2, because there is no evidence-preserving way to infer the
new axes from the old workflow, direction, or combined actor-role fields. Legacy
records have separate export and clear actions and are excluded from v2 counts.
