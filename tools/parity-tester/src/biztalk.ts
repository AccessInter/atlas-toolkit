/**
 * BizTalk orchestration (XLANG) business logic, migrated to plain functions.
 *
 * The structural shape Receive → Decide → Transform → Send maps onto an Azure
 * Logic Apps workflow.json (trigger → Condition → Compose → action). The
 * workflow itself is declarative and not executable here, so we capture the
 * *business logic* it encodes — the decision and the map — which CAN be
 * parity-tested. See patterns/biztalk/xlang-to-logic-apps.md.
 *
 * Amounts are whole currency units (integers) to keep the demo exact; real
 * money fields should follow the decimal-arithmetic pattern (scaled BigInt).
 */

export interface Order {
  id: string;
  amount: number; // whole units
  country: string; // ISO-2
}

export interface Invoice {
  invoiceId: string;
  net: number;
  vat: number;
  gross: number;
  region: "NA" | "INTL";
}

/** Decide shape — BizTalk Decide / Logic Apps Condition. */
export function routeOrder(order: Order): "priority" | "standard" {
  return order.amount >= 1000 ? "priority" : "standard";
}

/** Map shape — BizTalk map / Logic Apps Compose. VAT depends on region. */
export function mapOrderToInvoice(order: Order): Invoice {
  const region: "NA" | "INTL" =
    order.country === "CA" || order.country === "US" ? "NA" : "INTL";
  const vatRate = region === "NA" ? 0 : 20; // simplified business rule
  const net = order.amount;
  const vat = (net * vatRate) / 100;
  return {
    invoiceId: `INV-${order.id}`,
    net,
    vat,
    gross: net + vat,
    region,
  };
}
