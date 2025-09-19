import dotenv from 'dotenv';
import { getDatabricksService } from '../services/databricks.service';
import { logger } from '../utils/logger';

dotenv.config();

async function main() {
  const svc: any = getDatabricksService();
  await svc.connect();
  const session = await svc.getSession();
  const sql = process.argv[2] || 'SELECT 1 as one';
  logger.debug('Executing SQL:', sql);
  const op = await session.executeStatement(sql, {});
  const res = await op.fetchAll();
  try {
    logger.debug('Result keys:', Object.keys(res || {}));
  } catch { /* intentionally ignored: best effort cleanup */ }
  logger.debug('Raw result:', res);
  await op.close();
  await svc.disconnect();
}

main().catch((e) => {
  logger.error(e);
  process.exit(1);
});

