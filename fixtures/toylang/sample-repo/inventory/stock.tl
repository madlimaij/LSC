MODULE stock
INCLUDE "inventory/warehouse.tl"

PROC refresh_stock()
	READ	stock_levels WHERE qty < reorder_level
	WHILE ROWCOUNT() > 0 DO
		CALL warehouse.reorder(product_id)
		IF urgent THEN
			CALL notify_buyer(product_id)
		ENDIF
	ENDWHILE
ENDPROC

PROC notify_buyer(product_id)
	LOG "reorder " + product_id
ENDPROC
