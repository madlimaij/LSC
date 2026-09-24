MODULE audit
INCLUDE "legacy--compat.tl"

PROC record(event)
  LET RECALL_count = RECALL_count + 1
  LET PROCESSOR = "audit"
  WRITE audit_log SET event = event, read = 0, write = 1
  CALL RECALL_orders(event)
ENDPROC

PROC RECALL_orders(event)
  RETURN
ENDPROC
