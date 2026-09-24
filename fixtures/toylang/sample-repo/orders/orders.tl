MODULE orders
INCLUDE "common.tl"

PROC load_order(order_id)
  READ orders WHERE id = order_id INTO ord
  IF ord_status = "new" THEN
    CALL billing.calc_total(order_id)
    IF FLAG("fast_shipping") THEN
      CALL shipping.book_express(order_id)
    ELSE
      CALL shipping.book_standard(order_id)
    ENDIF
  ENDIF
ENDPROC

PROC close_day()
  WHILE pending > 0 DO
    READ orders WHERE status = "open" INTO ord
    WRITE orders SET status = "closed" WHERE id = ord_id
    LET pending = pending - 1
  ENDWHILE
ENDPROC

ENTRY eod_orders -> close_day
