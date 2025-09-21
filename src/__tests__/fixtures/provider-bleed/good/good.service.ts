import type { SessionDetailRepositoryPort } from '../../../services/ports/session-detail.repository.port';

export function usePort(repo: SessionDetailRepositoryPort) {
  return repo;
}
