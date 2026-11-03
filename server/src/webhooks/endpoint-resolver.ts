import { findByPathToken } from '../db/repos/endpoints.repo.js';

export function resolveEndpoint(pathToken: string) {
  return findByPathToken(pathToken);
}
