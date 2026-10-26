-- Run the fetch-jobs Edge Function every hour (at :05). The publishable key is public; the function itself
-- refuses runs closer than 50 minutes apart, so the URL can't be used to burn API quota.
create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;

select cron.schedule('fetch-jobs-hourly', '5 * * * *', $$
  select net.http_post(
    url := 'https://zgermvxqepsucdqqqphr.supabase.co/functions/v1/fetch-jobs',
    headers := '{"Content-Type": "application/json", "apikey": "sb_publishable_0zUl687DBCj9gNMZMJedlQ_qPcJ08BL", "Authorization": "Bearer sb_publishable_0zUl687DBCj9gNMZMJedlQ_qPcJ08BL"}'::jsonb,
    body := '{}'::jsonb,
    timeout_milliseconds := 150000);
$$);
