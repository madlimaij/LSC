MODULE retry
INCLUDE "common.tl"

PROC retry_failed()
  READ failed_jobs WHERE attempts < 3 INTO job
  IF ROWCOUNT() > 0 THEN
    CALL common.log_event("retrying")
  ENDIF
-- ENDPROC is missing: the interpreter closes the procedure at end of file
