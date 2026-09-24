MODULE billing
INCLUDE "common.tl"
INCLUDE "billing/rates.tl"
-- Nightly invoice run. Owner: finance batch team.

PROC calc_total(order_id)
  READ orders WHERE id = order_id INTO ord
  LET t = 0
  IF FLAG("new_pricing") THEN
    CALL apply_discount(order_id)
    CALL rates.net_price(ord_amount) INTO t
  ELSE
    CALL legacy_total(order_id) INTO t
  ENDIF
  WRITE invoices SET total = t, order_ref = order_id
  RETURN
ENDPROC

PROC apply_discount(order_id)
  READ discounts WHERE order_id = order_id
  IF ROWCOUNT() > 0 THEN
    IF FLAG("stacked_discounts") THEN
      LOG "stacking discounts for " + order_id
    ENDIF
  ENDIF
ENDPROC

PROC legacy_total(order_id)
  -- CALL old_total(order_id) replaced in 2021
  READ order_lines WHERE order_id = order_id
  RETURN
ENDPROC

ENTRY nightly_billing -> calc_total
