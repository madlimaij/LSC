PROC calc_total(order_id)
  IF FLAG("new_pricing") THEN
    IF order_id > 0 THEN
      LOG "-- pricing v2 --"; CALL apply_discount(order_id)
    ENDIF
  ELSE
    CALL legacy_pricing (order_id)
  ENDIF
ENDPROC
