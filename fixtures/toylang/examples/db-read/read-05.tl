PROC load_customer(cid)
  IF cid > 0 THEN
    READ customers WHERE id = cid INTO cust
    IF vip = 1 THEN
      READ vip_benefits WHERE customer_id = cid
    ENDIF
  ENDIF
ENDPROC
