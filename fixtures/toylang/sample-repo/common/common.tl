MODULE common
-- Shared helpers. Keep this module free of database access.

PROC log_event(msg)
  LOG NOW() + " " + msg
ENDPROC

PROC fail(msg)
  LOG "FAILED: " + msg
  CALL log_event(msg)
ENDPROC
