MODULE flags
-- Flag overview for operations. Note: "don't remove flags here
INCLUDE "common.tl"

PROC check_flags(flag_name)
  LET enabled = FLAG(flag_name)
  LET legacy = FLAG("legacy--mode")
  IF FLAG("audit") THEN -- FLAG("audit_v2") not yet
    LOG "FLAG audit is on"
  ENDIF
  LET FLAGSHIP_store = "berlin"
ENDPROC
