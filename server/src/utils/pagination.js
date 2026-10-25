import { z } from 'zod';
import { objectId, parse } from './errors.js';

const schema = z.object({
  cursor: objectId.optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

export const pageParams = (query) => parse(schema, { cursor: query.cursor, limit: query.limit });

/** Fetches limit+1 docs to know whether another page exists. `find` receives (cursorFilter, take). */
export async function paginate(run, { cursor, limit }, direction = 'desc') {
  const filter = cursor ? { _id: direction === 'desc' ? { $lt: cursor } : { $gt: cursor } } : {};
  const docs = await run(filter, limit + 1);
  const hasMore = docs.length > limit;
  const items = hasMore ? docs.slice(0, limit) : docs;
  return { items, nextCursor: hasMore ? String(items[items.length - 1]._id) : null };
}
