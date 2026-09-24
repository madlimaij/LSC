MODULE reports
INCLUDE "common.tl"

PROC build_report()
  EXEC "READ audit_log WHERE day = today"
  EXEC "WRITE report_cache SET built = 1"
  READ report_definitions INTO defs
  CALL common.log_event("report built")
ENDPROC

ENTRY weekly_report -> build_report
ENTRY daily_report  -> build_report
