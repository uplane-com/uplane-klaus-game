-- Linear tickets for the ticket wall (projected from ticket.* events).
create table tickets (
  id          text primary key,
  key         text not null,
  title       text not null,
  state_name  text not null,
  state_type  text not null,
  priority    smallint not null default 0,
  team        text,
  assignee    text,
  url         text,
  updated_at  timestamptz not null
);
create index tickets_updated_idx on tickets (updated_at desc);
