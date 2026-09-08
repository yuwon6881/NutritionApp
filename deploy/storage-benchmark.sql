-- DISPOSABLE TEST DATABASE ONLY. Uses a rollback, but PostgreSQL may retain allocated pages.
begin;
insert into "Users" ("Id","Username","PasswordHash","Slot","Revision","ProfileRevision","ProfileJson")
values ('00000000-0000-0000-0000-000000000001','benchmark-one','disabled',91,0,0,''),
       ('00000000-0000-0000-0000-000000000002','benchmark-two','disabled',92,0,0,'');
insert into "Entries" ("UserId","Id","Revision","Deleted","Name","Calories","Protein","Fat","Carbs","Fiber","Source","Date","Meal","Quantity","Unit")
select u.id, gen_random_uuid(), n, false, 'Representative Malaysian mixed meal', 450, 20, 15, 55, 3, 'Personal recipe',
       date '2016-01-01'+((n-1)/20)::integer, 'Lunch', 250, 'g'
from (values ('00000000-0000-0000-0000-000000000001'::uuid),('00000000-0000-0000-0000-000000000002'::uuid)) u(id)
cross join generate_series(1,73000) n;
select pg_database_size(current_database()) as database_bytes,
       pg_total_relation_size('"Entries"') as diary_with_indexes_bytes;
rollback;
