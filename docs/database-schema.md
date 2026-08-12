# Base de datos

`people` y `cases` separan datos personales de la condición/publicación. `case_reports` contiene reportes que empiezan en `pending`; `reporter_contacts`, `media_assets`, `status_history` y `audit_logs` son privados. `public_case_cards` expone solo campos seguros y deriva `approved_reports_count` de reportes aprobados.

Las migraciones habilitan `pg_trgm`, `unaccent`, RLS, auditoría y checks para impedir un `deceased_confirmed` sin `authority_confirmed`, motivo y referencia privada.
