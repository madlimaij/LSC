MODULE invoices
INCLUDE "common.tl"

PROC close_invoice(inv_id)
  READ invoices WHERE id = inv_id INTO inv
  WRITE invoices &
    SET status = "closed", &
        closed_at = NOW() &
    WHERE id = inv_id
  WRITE invoice_history SET inv = inv_id, event = "closed"
  CALL common.log_event("invoice closed")
ENDPROC

PROC reopen_invoice(inv_id)
  LOG "WRITE invoices SET status = open"   -- message only
  WRITE invoices SET status = "open" WHERE id = inv_id
ENDPROC
