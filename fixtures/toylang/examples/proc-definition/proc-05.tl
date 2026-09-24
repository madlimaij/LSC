MODULE stock

	PROC   refresh_stock ()
	  CALL sync_warehouse()
	ENDPROC
