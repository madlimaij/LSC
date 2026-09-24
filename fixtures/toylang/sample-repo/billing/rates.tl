MODULE rates
INCLUDE "common.tl"

FUNC net_price(amount) RETURNS NUMBER
  LET vat = 0.2
  IF FLAG("eu_vat") AND FLAG("vat.v2") THEN
    READ vat_rates WHERE region = current_region INTO vat
  ENDIF
  RETURN amount * (1 + vat)
ENDFUNC

FUNC round_price(amount) RETURNS NUMBER
  RETURN amount
ENDFUNC
