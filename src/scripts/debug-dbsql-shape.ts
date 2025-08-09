import dotenv from 'dotenv';
import { getDatabricksService } from '../services/databricks.service';

dotenv.config();

async function main() {
  const svc: any = getDatabricksService();
  await svc.connect();
  const session = await svc.getSession();
  const sql = process.argv[2] || 'SELECT 1 as one';
  console.log('Executing SQL:', sql);
  const op = await session.executeStatement(sql, {});
  const res = await op.fetchAll();
  try {
    console.log('Result keys:', Object.keys(res || {}));
  } catch {}
  console.log('Raw result:', res);
  await op.close();
  await svc.disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});


