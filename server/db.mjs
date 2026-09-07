import fs from 'node:fs/promises';
import path from 'node:path';
import mysql from 'mysql2/promise';
import { config } from './config.mjs';

export const pool = mysql.createPool({
  ...config.db,
  waitForConnections: true,
  queueLimit: 0,
  charset: 'utf8mb4',
  timezone: 'Z',
  dateStrings: true,
  decimalNumbers: true,
  namedPlaceholders: true,
});

export async function migrate() {
  const migrationDir = new URL('./migrations/', import.meta.url);
  const names = (await fs.readdir(migrationDir)).filter(name => name.endsWith('.sql')).sort();
  const connection = await pool.getConnection();
  try {
    for (const name of names) {
      const sql = await fs.readFile(new URL(name, migrationDir), 'utf8');
      const statements = sql.split(/;\s*(?:\r?\n|$)/).map(value => value.trim()).filter(Boolean);
      for (const statement of statements) await connection.query(statement);
    }
  } finally {
    connection.release();
  }
}

export async function transaction(fn) {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const result = await fn(connection);
    await connection.commit();
    return result;
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

export async function select(sql, params = {}) {
  const [rows] = await pool.execute(sql, params);
  return rows;
}

export async function one(sql, params = {}) {
  const rows = await select(sql, params);
  return rows[0] || null;
}

export async function execute(sql, params = {}) {
  const [result] = await pool.execute(sql, params);
  return result;
}

export async function ping() {
  const row = await one('SELECT VERSION() AS version, DATABASE() AS database_name, UTC_TIMESTAMP(3) AS server_time');
  return row;
}

export async function closeDb() {
  await pool.end();
}

export const migrationPath = path.resolve(new URL('./migrations/', import.meta.url).pathname);

