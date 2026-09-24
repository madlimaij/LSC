MODULE warehouse

PROC reorder(product_id)
  LOG "/*"; CALL sync_warehouse(product_id)
  /* old: CALL legacy_reorder(product_id) */ CALL place_order(product_id)
  WRITE purchase_orders SET product = product_id
ENDPROC

PROC sync_warehouse(product_id)
  /* note: "sync path is slow, see ticket 4711 */ CALL common.log_event("sync")
  LOG "syncing"
ENDPROC

PROC place_order(product_id)
  RETURN
ENDPROC
