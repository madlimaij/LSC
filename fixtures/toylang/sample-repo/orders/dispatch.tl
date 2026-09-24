MODULE dispatch
-- Dispatches an order to the handler configured for its channel.

PROC dispatch(order_id, channel)
  READ channel_handlers WHERE channel = channel INTO handler_name
  -- The handler name is only known at run time:
  CALL DYNAMIC handler_name(order_id)
  CALL common.log_event("dispatched")
ENDPROC
