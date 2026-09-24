MODULE order_lines

PROC load_lines(oid)
  READ &
      order_lines WHERE order_id = oid
  READ products WHERE id = line_product; READ stock_levels WHERE product = line_product
ENDPROC
