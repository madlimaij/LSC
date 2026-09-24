IF retry THEN
  call orders.reprocess(batch_id) INTO result
ENDIF
