-- The registration form offers "Buying Agent", which had no business type,
-- so those sign-ups failed with "Invalid BusinessTypeCode". Safe to re-run.
insert into business_types(code, name)
select 'BuyingAgent', 'Buying Agent'
where not exists (select 1 from business_types where code = 'BuyingAgent');
