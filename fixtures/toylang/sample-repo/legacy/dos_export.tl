MODULE dos_export
INCLUDE "common.tl"

PROC export_orders()
  READ orders WHERE exported = 0
  WRITE export_log SET n = ROWCOUNT()
ENDPROC
