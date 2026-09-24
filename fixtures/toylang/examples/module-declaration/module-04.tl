MODULE orders
INCLUDE "common.tl"

PROC load_order(order_id)
  READ orders WHERE id = order_id
ENDPROC
