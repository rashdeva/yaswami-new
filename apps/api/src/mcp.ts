// MCP-сервер: те же операции, что в REST, для Claude, Codex и других клиентов. Действует от имени владельца токена.
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import * as z from 'zod';
import type { User } from '@yaswami/core';
import { EventCreateInput, EventUpdateInput, RsvpInput, TicketTypeCreateInput, TicketTypeUpdateInput } from '@yaswami/core';
import type { Db } from './db/client.ts';
import * as s from './services.ts';

const event_id = z.string().describe('Event id, e.g. e_2a9c41b7d0');
const ticket_type_id = z.string().describe('Ticket type id (uuid)');

const KINDS = 'Event kind is a visual template: f — party, b — birthday, w — wedding, c — coffee/meetup, s — sport, o — other.';

function buildServer(db: Db, actor: User) {
  const server = new McpServer({ name: 'yaswami', version: '0.1.0' });

  // Ошибка правил (нет мест, нет прав) — это ответ инструмента, а не сбой протокола: модель должна её прочитать.
  const tool = <Shape extends z.ZodRawShape>(
    name: string,
    config: { title: string; description: string; shape: Shape; readOnly?: boolean; destructive?: boolean },
    run: (args: z.infer<z.ZodObject<Shape>>) => Promise<unknown>,
  ) =>
    server.registerTool(
      name,
      {
        title: config.title,
        description: config.description,
        inputSchema: config.shape,
        annotations: { readOnlyHint: !!config.readOnly, destructiveHint: !!config.destructive, openWorldHint: false },
      },
      (async (args: z.infer<z.ZodObject<Shape>>) => {
        try {
          return { content: [{ type: 'text' as const, text: JSON.stringify((await run(args)) ?? { ok: true }) }] };
        } catch (e) {
          if (!(e instanceof s.AppError)) throw e;
          return { isError: true, content: [{ type: 'text' as const, text: JSON.stringify({ error: e.code }) }] };
        }
      }) as never,
    );

  tool('events_list', {
    title: 'List my events', readOnly: true, shape: {},
    description: 'Events the user hosts or has responded to, ordered by start time. Start here to get event ids.',
  }, () => s.listEvents(db, actor));

  tool('event_get', {
    title: 'Get event', readOnly: true, shape: { event_id },
    description: 'One event with its ticket types, guest list (first names only), counts and the user\'s own response.',
  }, (a) => s.getEvent(db, actor, a.event_id));

  tool('event_create', {
    title: 'Create event', shape: EventCreateInput.shape,
    description: `Create an event hosted by the user. A default free ticket type is created with it. ${KINDS}`,
  }, (a) => s.createEvent(db, actor, a));

  tool('event_update', {
    title: 'Update event', shape: { event_id, ...EventUpdateInput.shape },
    description: 'Change fields of an event the user hosts. Only passed fields change. Set status to "cancelled" to cancel.',
  }, ({ event_id: id, ...input }) => s.updateEvent(db, actor, id, input));

  tool('event_rsvp', {
    title: 'Respond to event', shape: { event_id, ...RsvpInput.shape },
    description: 'Set the user\'s own response: going, maybe or declined. Pass ticket_type_id when the event has several visible ticket types. Errors: full, ticket_required, closed.',
  }, ({ event_id: id, ...input }) => s.rsvpEvent(db, actor, id, input));

  tool('ticket_type_create', {
    title: 'Add ticket type', shape: { event_id, ...TicketTypeCreateInput.shape },
    description: 'Add a free ticket type to an event the user hosts. max_capacity limits seats of this type; price_text is a label only, no payment is taken.',
  }, ({ event_id: id, ...input }) => s.createTicketType(db, actor, id, input));

  tool('ticket_type_update', {
    title: 'Update ticket type', shape: { ticket_type_id, ...TicketTypeUpdateInput.shape },
    description: 'Change a ticket type of an event the user hosts. The last visible ticket type cannot be hidden.',
  }, ({ ticket_type_id: id, ...input }) => s.updateTicketType(db, actor, id, input));

  tool('ticket_type_delete', {
    title: 'Delete ticket type', destructive: true, shape: { ticket_type_id },
    description: 'Delete a ticket type. Fails if guests hold it or if it is the last (or last visible) type of the event.',
  }, (a) => s.deleteTicketType(db, actor, a.ticket_type_id));

  return server;
}

/** Один запрос — один сервер: состояния между запросами нет, поэтому сервис масштабируется без общих сессий. */
export async function handleMcp(db: Db, actor: User, request: Request): Promise<Response> {
  const server = buildServer(db, actor);
  const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  await server.connect(transport);
  return transport.handleRequest(request);
}
