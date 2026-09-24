module month_end
include "common.tl"

proc close_month()
  read ledger where period = current_period into led
  if flag("month_end_v2") then
    call post_accruals(current_period)
  endif
  write ledger set closed = 1 where period = current_period
endproc

proc post_accruals(period)
  write accruals set period = period
endproc

entry month_end->close_month
