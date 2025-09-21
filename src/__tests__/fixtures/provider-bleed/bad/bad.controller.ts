import { sessionRepository } from '../../../adapters/repositories/databricks-session.repository';

export function useRepo() {
  return sessionRepository;
}
