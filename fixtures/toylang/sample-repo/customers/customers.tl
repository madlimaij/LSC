MODULE customers
INCLUDE "common.tl"

PROC load_customer(cid)
  read customers WHERE id = cid INTO cust
  IF FLAG ( "vip-program" ) THEN
    READ vip_benefits WHERE customer_id = cid
  ENDIF
ENDPROC

PROC merge_customers(a, b)
  WRITE customers SET merged_into = a WHERE id = b
  WRITE customer_audit SET event = "merge", ref = b
ENDPROC
