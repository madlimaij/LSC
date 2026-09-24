MODULE nightly
INCLUDE "common.tl"

PROC run_all()
  CALL billing.calc_total(0)
  CALL &
      late_bound_cleanup()
  CALL orders.close_day()
ENDPROC

PROC late_bound_cleanup()
  LOG "cleanup"
ENDPROC

ENTRY nightly_all -> run_all
ENTRY nightly_billing_only -> billing.calc_total
