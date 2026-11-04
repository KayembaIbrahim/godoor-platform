WITH drifts AS (
  SELECT w.user_id, w.escrow_balance,
         COALESCE(SUM(h.amount) FILTER (WHERE EXISTS (SELECT 1 FROM public.orders o WHERE o.id=h.order_id AND o.customer_id=w.user_id)),0) AS held_sum
  FROM public.wallets w LEFT JOIN public.escrow_holds h ON h.status='held'
  GROUP BY w.user_id, w.escrow_balance
)
SELECT 'drift_wallets' AS k, count(*)::text AS v FROM drifts WHERE escrow_balance <> held_sum
UNION ALL
SELECT 'escrow_total', count(*)::text FROM public.escrow_holds WHERE status='held'
UNION ALL
SELECT 'orders_total', count(*)::text FROM public.orders
UNION ALL
SELECT 'wallets_posesc', count(*)::text FROM public.wallets WHERE escrow_balance>0;
