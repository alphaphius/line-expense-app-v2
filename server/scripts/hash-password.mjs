import process from 'node:process';
import readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import { hashPassword } from '../auth.mjs';

const cli = readline.createInterface({ input, output });
try {
  const first = process.env.WORKHUB_PASSWORD || await cli.question('รหัสผ่าน WorkHub: ');
  const second = process.env.WORKHUB_PASSWORD || await cli.question('ยืนยันรหัสผ่าน: ');
  if (!first || first !== second) throw new Error('รหัสผ่านว่างหรือยืนยันไม่ตรงกัน');
  output.write(`${await hashPassword(first)}\n`);
} finally {
  cli.close();
}
