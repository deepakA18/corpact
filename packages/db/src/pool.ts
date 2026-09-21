import pg from 'pg';

export type Db = pg.Pool;
export type DbClient = pg.PoolClient;
/** Anything that can run a query: the pool, or a client inside a transaction. */
export type Queryable = Pick<pg.Pool, 'query'>;

export function createDb(connectionString: string | undefined = process.env.DATABASE_URL): Db {
  if (!connectionString) throw new Error('DATABASE_URL is not set');
  // numeric and int8 come back as strings (pg default) - never coerced to JS number.
  return new pg.Pool({ connectionString, max: 10 });
}

export async function withTransaction<T>(db: Db, work: (client: DbClient) => Promise<T>): Promise<T> {
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    const result = await work(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch (rollbackError) {
      throw new AggregateError([err, rollbackError], 'Transaction failed and could not be rolled back');
    }
    throw err;
  } finally {
    client.release();
  }
}
