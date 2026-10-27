import { describe, it, expect } from "vitest";
import { routeOrder, mapOrderToInvoice } from "../src/biztalk";

// Business logic of an XLANG orchestration, the part that survives the move to
// a Logic Apps workflow.json. Golden values = what the BizTalk map/decide produced.
describe("BizTalk orchestration logic → functions", () => {
  it("Decide: amount >= 1000 routes priority, else standard", () => {
    expect(routeOrder({ id: "1", amount: 1500, country: "CA" })).toBe("priority");
    expect(routeOrder({ id: "2", amount: 999, country: "FR" })).toBe("standard");
  });

  it("Map: North America order → 0% VAT", () => {
    expect(mapOrderToInvoice({ id: "100", amount: 2000, country: "US" })).toEqual({
      invoiceId: "INV-100",
      net: 2000,
      vat: 0,
      gross: 2000,
      region: "NA",
    });
  });

  it("Map: international order → 20% VAT", () => {
    expect(mapOrderToInvoice({ id: "200", amount: 1500, country: "FR" })).toEqual({
      invoiceId: "INV-200",
      net: 1500,
      vat: 300,
      gross: 1800,
      region: "INTL",
    });
  });
});
