PROC close_order(oid)
  READ orders WHERE id = oid
  WRITE orders SET status = "closed" WHERE id = oid
  WRITE audit_log SET event = "close", ref = oid
ENDPROC
