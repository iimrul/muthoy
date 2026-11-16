import { describe, expect, it } from "vitest";
import { fromTaka } from "../../types/src/money";
import { batchFieldsSchema, purchaseLineItemFieldsSchema, expenseFormSchema, openingCashFormSchema, endOfDayFormSchema, cashReconcileFormSchema, withdrawalFormSchema, tenderedAmountSchema } from "./index";
import { hasMoneyPrecision, hasExcessMoneyDecimals, moneyDraftValue, moneyAmountSchema } from "./money";

describe("money precision boundary", () => {
  it.each([["1.15",115],["0.10",10],["1.",100],["1.00",100],["0",0]] as const)("keeps %s as exact %s paisa",(text,paisa)=>{
    const value=moneyDraftValue(text);expect(hasExcessMoneyDecimals(text)).toBe(false);
    expect(moneyAmountSchema.safeParse(value).success).toBe(true);expect(fromTaka(value!)).toBe(paisa);
  });
  it.each(["12.345","0.005","0.004","1.000","12.3400","1e-3","1.000e0"])("explicitly refuses raw %s without rounding",text=>{
    expect(hasExcessMoneyDecimals(text)).toBe(true);expect(moneyDraftValue(text)).toBeNaN();expect(moneyAmountSchema.safeParse(moneyDraftValue(text)).success).toBe(false);
  });
  it.each([12.345,0.005,0.004,1e-7,NaN,Infinity])("rejects numeric precision %s",value=>expect(hasMoneyPrecision(value)).toBe(false));
  it("keeps an empty draft undefined",()=>expect(moneyDraftValue("")).toBeUndefined());
  it.each([12.345,0.005,0.004])("protects all existing numeric taka schema boundaries from %s",value=>{
    for(const schema of [batchFieldsSchema,purchaseLineItemFieldsSchema]) for(const key of ["purchasePrice","salePrice"]) {
      const result=schema.safeParse({batchNo:"SYNTH",expiryDate:"2099-01-01",quantity:1,purchasePrice:1,salePrice:2,[key]:value});
      expect(result.success).toBe(false);
      if(!result.success) expect(result.error.issues).toContainEqual(expect.objectContaining({path:[key],message:"Use no more than two decimal places"}));
    }
    for(const [schema,field,extra] of [[expenseFormSchema,"amountTaka",{category:"utilities"}],[openingCashFormSchema,"openingCashTaka",{}],[endOfDayFormSchema,"countedCashTaka",{}],[cashReconcileFormSchema,"countedCashTaka",{}],[withdrawalFormSchema,"amountTaka",{}]] as const) expect(schema.safeParse({...extra,[field]:value}).success).toBe(false);
    expect(tenderedAmountSchema.safeParse(String(value)).success).toBe(false);
  });
});
