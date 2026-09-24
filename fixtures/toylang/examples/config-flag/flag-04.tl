PROC ship(oid)
  IF FLAG("fast_shipping") THEN
    IF FLAG("fast_shipping_eu") THEN
      LET carrier = "dhl"
    ENDIF
  ENDIF
ENDPROC
