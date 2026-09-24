MODULE dates

FUNC month_start(d) RETURNS DATE
  -- "PROC" and "FUNC" in the messages below are plain text
  LOG "FUNC month_start called"
  RETURN d
ENDFUNC

FUNC is_weekend(d) RETURNS BOOLEAN
  LET PROCESSOR = "dates"
  RETURN 0
ENDFUNC
