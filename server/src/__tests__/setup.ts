import { migrate } from '../db/migrate.js';

// Les tests utilisent la base locale : on garantit le schéma à jour.
migrate();
