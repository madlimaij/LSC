MODULE billing

PROC calc_total(order_id)
  -- CALL fake_call(x) must be ignored: it's a comment
  READ orders WHERE id = order_id INTO ord
  READ &
      order_lines WHERE order_id = order_id
  WRITE totals SET amount = 42 WHERE id = order_id
  LET msg = "READ hidden_table should not match"
  CALL tax.apply(order_id)
  IF FLAG("fast_shipping") THEN
    CALL shipping.book(order_id)
  ENDIF
ENDPROC

ENTRY run_billing -> calc_total
