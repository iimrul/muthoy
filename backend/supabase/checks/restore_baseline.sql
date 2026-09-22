-- H-11 automated restore fingerprint. SELECT-only and safe to execute.
-- The operational C5 restore rehearsal remains explicitly unexecuted.
WITH fingerprints AS (
  SELECT 'sales' scope, count(*) rows, coalesce(sum(total),0) total_paisa,
    md5(coalesce(string_agg(concat_ws(':',id,invoice_no,total,cash_applied,credit_amount,
      discount_amount,tax_amount,payment_type,business_date), '|' ORDER BY id),'')) digest
  FROM public.sales WHERE not is_deleted
  UNION ALL
  SELECT 'sale_items', count(*), coalesce(sum(line_total),0),
    md5(coalesce(string_agg(concat_ws(':',id,sale_id,medicine_id,batch_id,qty,unit_price,
      discount_amount,line_total,cogs), '|' ORDER BY id),''))
  FROM public.sale_items WHERE not is_deleted
  UNION ALL
  SELECT 'payments', count(*), coalesce(sum(amount),0),
    md5(coalesce(string_agg(concat_ws(':',id,type,party_id,amount,method,ref_id,created_by,note),
      '|' ORDER BY id),''))
  FROM public.payments WHERE not is_deleted
  UNION ALL
  SELECT 'credits', count(*), coalesce(sum(amount),0),
    md5(coalesce(string_agg(concat_ws(':',id,customer_id,sale_id,amount,balance),
      '|' ORDER BY id),''))
  FROM public.credits WHERE not is_deleted
  UNION ALL
  SELECT 'credit_payment_allocations', count(*), coalesce(sum(amount),0),
    md5(coalesce(string_agg(concat_ws(':',id,customer_id,payment_id,credit_id,amount),
      '|' ORDER BY id),''))
  FROM public.credit_payment_allocations WHERE not is_deleted
  UNION ALL
  SELECT 'credit_reconciliation_states', count(*), 0::bigint,
    md5(coalesce(string_agg(concat_ws(':',id,customer_id,status,canonical_hash,verified_by,verified_at),
      '|' ORDER BY id),''))
  FROM public.credit_reconciliation_states WHERE not is_deleted
  UNION ALL
  SELECT 'purchases', count(*), coalesce(sum(total),0),
    md5(coalesce(string_agg(concat_ws(':',id,invoice_no,supplier_id,total,paid_amount,payment_terms,
      invoice_date), '|' ORDER BY id),''))
  FROM public.purchases WHERE not is_deleted
  UNION ALL
  SELECT 'purchase_items', count(*), coalesce(sum(qty * purchase_price),0),
    md5(coalesce(string_agg(concat_ws(':',id,purchase_id,medicine_id,batch_no,expiry_date,qty,
      purchase_price,sale_price,status,received_at), '|' ORDER BY id),''))
  FROM public.purchase_items WHERE not is_deleted
  UNION ALL
  SELECT 'purchase_returns', count(*), coalesce(sum(credit_amount),0),
    md5(coalesce(string_agg(concat_ws(':',id,purchase_id,purchase_item_id,qty,reason,credit_amount,
      created_by), '|' ORDER BY id),''))
  FROM public.purchase_returns WHERE not is_deleted
  UNION ALL
  SELECT 'batches', count(*), coalesce(sum(stock * purchase_price),0),
    md5(coalesce(string_agg(concat_ws(':',id,medicine_id,batch_no,expiry_date,stock,purchase_price,
      sale_price,oversold_at), '|' ORDER BY id),''))
  FROM public.batches WHERE not is_deleted
  UNION ALL
  SELECT 'inventory_movements', count(*), coalesce(sum(change_qty),0),
    md5(coalesce(string_agg(concat_ws(':',id,batch_id,change_qty,reason,ref_id,created_by),
      '|' ORDER BY id),''))
  FROM public.inventory_movements WHERE not is_deleted
  UNION ALL
  SELECT 'expenses', count(*), coalesce(sum(amount),0),
    md5(coalesce(string_agg(concat_ws(':',id,category,amount,description,receipt_image,created_by),
      '|' ORDER BY id),''))
  FROM public.expenses WHERE not is_deleted
  UNION ALL
  SELECT 'cash_drawer', count(*), coalesce(sum(closing_expected),0),
    md5(coalesce(string_agg(concat_ws(':',id,business_date,opening_cash,opened_by,closed_by,opened_at,
      closed_at,closing_expected,closing_counted,reconciled_counted_amount,reconciled_at,reconciled_by),
      '|' ORDER BY id),''))
  FROM public.cash_drawer WHERE not is_deleted
  UNION ALL
  SELECT 'sale_refunds', count(*), coalesce(sum(total_amount),0),
    md5(coalesce(string_agg(concat_ws(':',id,sale_id,claim_id,claim_token,reason,total_amount,
      business_date,created_by), '|' ORDER BY id),''))
  FROM public.sale_refunds WHERE not is_deleted
  UNION ALL
  SELECT 'sales_returns', count(*), coalesce(sum(refund_amount),0),
    md5(coalesce(string_agg(concat_ws(':',id,sale_id,sale_item_id,refund_id,qty,reason,refund_amount,
      refund_method,created_by), '|' ORDER BY id),''))
  FROM public.sales_returns WHERE not is_deleted
  UNION ALL
  SELECT 'refund_tenders', count(*), coalesce(sum(amount),0),
    md5(coalesce(string_agg(concat_ws(':',id,refund_id,kind,method,amount,source_payment_id),
      '|' ORDER BY id),''))
  FROM public.refund_tenders WHERE not is_deleted
)
SELECT scope, rows, total_paisa, digest FROM fingerprints ORDER BY scope;
