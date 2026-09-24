MODULE messages

PROC unread_count(uid)
  READ inbox WHERE owner = uid AND NOT read
  LET n = ROWCOUNT()
  RETURN n
ENDPROC

PROC mark_read(msg_id)
  WRITE inbox SET read = 1 WHERE id = msg_id
ENDPROC
