import mysql, {
  type Pool,
  type ResultSetHeader,
  type RowDataPacket,
  type QueryResult,
} from 'mysql2/promise';
import type { AppConfig } from '../config.js';

let pool: Pool | null = null;

export function getPool(config: AppConfig): Pool {
  if (!pool) {
    pool = mysql.createPool({
      uri: config.DATABASE_URL,
      waitForConnections: true,
      connectionLimit: 10,
      ssl: { rejectUnauthorized: false },
    });
  }
  return pool;
}

export async function query<T extends RowDataPacket[]>(
  config: AppConfig,
  sql: string,
  params: unknown[] = [],
): Promise<T> {
  const [rows] = await getPool(config).query<T>(sql, params);
  return rows;
}

export async function execute(
  config: AppConfig,
  sql: string,
  params: Array<string | number | null | Date> = [],
): Promise<{ insertId: number; affectedRows: number }> {
  const [result] = await getPool(config).execute<QueryResult>(sql, params);
  const info = result as ResultSetHeader;
  return { insertId: info.insertId ?? 0, affectedRows: info.affectedRows ?? 0 };
}
