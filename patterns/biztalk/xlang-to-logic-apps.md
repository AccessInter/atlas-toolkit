# BizTalk orchestration (XLANG) → Azure Logic Apps

**Difficulty:** 🔴 Hard — structure is declarative, business logic must be preserved exactly
**Version:** 1.0
**Last updated:** 2026-05-30

## Description

A BizTalk orchestration (XLANG) is an integration workflow: **Receive** a
message, **Decide** / loop, **Transform** via a map, **Send**. Azure Logic Apps
expresses the same shape declaratively in a `workflow.json` (a trigger plus
actions: `Condition`, `Compose`, `Foreach`, connectors). The structural port is
mechanical; the risk is the **business logic** inside the decides and maps —
that must be reproduced and tested, not eyeballed.

## Source (XLANG, simplified)
```
receive Order
decide
    when (Order.Amount >= 1000)  -> send to PriorityPort
    else                         -> send to StandardPort
construct Invoice
    map Order -> Invoice   (VAT depends on region)
send Invoice
```

## Target (Logic Apps `workflow.json`, shape)
```jsonc
{
  "triggers": { "whenOrderReceived": { "type": "Request" } },
  "actions": {
    "RouteByAmount": {
      "type": "If",
      "expression": "@greaterOrEquals(triggerBody()?['amount'], 1000)",
      "actions":    { "SendPriority": { "type": "ApiConnection" } },
      "else":       { "actions": { "SendStandard": { "type": "ApiConnection" } } }
    },
    "BuildInvoice": { "type": "Compose", "inputs": { /* map Order -> Invoice */ } }
  }
}
```

The **decide** and **map** logic is captured and parity-tested in
[`tools/parity-tester/src/biztalk.ts`](../../tools/parity-tester/src/biztalk.ts)
(`routeOrder`, `mapOrderToInvoice`).

## Rules

- **Receive/Send ports** → Logic Apps trigger + connector actions (Service Bus, HTTP, SFTP…).
- **Decide** → `Condition` / `Switch`. Keep the **exact** comparison and branch order.
- **Map (BTM)** → `Compose` / `Liquid` transform, or a connector. Re-implement field mapping and computed fields verbatim; do not "tidy" the logic.
- **Loops (`while` / `foreach`)** → `Until` / `Foreach`.
- **Correlation sets / convoys** → Logic Apps stateful workflows + correlation; one of the trickiest parts, review case by case.
- **Persisted state / long-running** → stateful Logic Apps (Standard), not Consumption stateless.

## Known edge cases

- **Money in maps:** a map that computes totals/VAT must follow the [decimal-arithmetic](../cobol/decimal-arithmetic.md) pattern — never IEEE-754 floats. **Flag any rounding rule** in the discrepancy registry.
- **Ordered delivery / convoys:** BizTalk convoys guarantee ordering; Logic Apps needs explicit sequencing — a silent behavior change otherwise.
- **Distinguished fields vs promoted properties:** routing on a promoted property must map to the trigger/parse step that exposes the same field.
- **Empty / null message parts:** XLANG and Logic Apps differ on null handling; test boundary messages.

## Parity test

[`tools/parity-tester/tests/biztalk-orchestration.test.ts`](../../tools/parity-tester/tests/biztalk-orchestration.test.ts) — asserts the routing decision and the order→invoice map (NA 0% vs international 20% VAT) against golden values.

## Contributors
- Access International team (init)
