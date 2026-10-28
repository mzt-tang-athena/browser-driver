---
id: 0008
title: Fill form fields before choosing an action
created: 2026-10-28
priority: high
assignee:
pr:
depends: [0002]
---

## Spec

The planner can type and select, but the loop asks it only when the reflex
is unsure, stuck, or repeating. On a form page the reflex clicks ahead at
full confidence and the fields stay empty. Real form goals fail this way.

Add a field phase, like the work repo's fillFields:

1. After the page is read, find empty text fields and unset selects.
2. Ask the planner for a value for each field the goal needs. It writes
   the text; the reflex cannot.
3. Fill the fields, then choose the click action in the next step.
4. Mark handled fields so the loop does not refill them every step.
5. Log the field decisions and their cost.

## Acceptance

- [ ] A goal that needs a name fills the name field before the next click
- [ ] A select field gets a goal-appropriate option
- [ ] A field is not refilled once it holds the value
- [ ] Field decisions appear in the step log with their cost
- [ ] Tests cover the field phase

## Outcome

(filled in before moving to done/)
