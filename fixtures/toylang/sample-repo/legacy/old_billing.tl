MODULE old_billing
/*
  Retired 2019. Kept for reference only.

  PROC calc_total_old(order_id)
    READ orders_archive WHERE id = order_id
    CALL old_discount(order_id)
    WRITE invoices_archive SET total = t
  ENDPROC

  ENTRY old_nightly -> calc_total_old
*/

PROC placeholder()
  RETURN
ENDPROC
ENDPROC
