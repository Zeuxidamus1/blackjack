with scores as (
 select r.case_id,r.item,i.guide,1/greatest(i.guide,1)::numeric as score
 from rips.case_rewards r join rips.catalog i on i.id=r.item where not r.chase
), quotas as (
 select *,1+(999999-count(*) over(partition by case_id))*score/sum(score) over(partition by case_id) as quota from scores
), apportioned as (
 select *,floor(quota)::int as base,
 row_number() over(partition by case_id order by quota-floor(quota) desc,guide,item) as rank
 from quotas
), final as (
 select *,999999-sum(base) over(partition by case_id) as remainder from apportioned
)
update rips.case_rewards r set weight=f.base+case when f.rank<=f.remainder then 1 else 0 end
from final f where r.case_id=f.case_id and r.item=f.item;
do $$ begin
 if exists(select 1 from rips.cases c left join rips.case_rewards r on r.case_id=c.id group by c.id
 having sum(r.weight) is distinct from 1000000 or count(*) filter(where r.chase and r.weight=1)<>1
 or count(*) filter(where r.chase)<>1)
 or exists(select 1 from rips.case_rewards a join rips.case_rewards b on a.case_id=b.case_id
 join rips.catalog i on i.id=a.item join rips.catalog j on j.id=b.item
 where not a.chase and not b.chase and i.guide>j.guide and a.weight>b.weight)
 then raise exception 'Invalid case odds'; end if;
end $$;