SELECT 'escrow_total' AS k, count(*)::text AS v FROM public.escrow_holds WHERE status='held'
UNION ALL
SELECT 'escrow_sum', COALESCE(sum(amount),0)::text FROM public.escrow_holds WHERE status='held'
UNION ALL
SELECT 'wallets_posesc', count(*)::text FROM public.wallets WHERE escrow_balance>0
UNION ALL
SELECT 'escrow_wallets_sum', COALESCE(sum(escrow_balance),0)::text FROM public.wallets
UNION ALL
SELECT 'orders_total', count(*)::text FROM public.orders
UNION ALL
SELECT 'orders_active', count(*)::text FROM public.orders WHERE status NOT IN ('delivered','cancelled');
